{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Executable.EthereumVM2
  ( handleVmTasks,
    writeBlockSummary,
    processBlocks,
  )
where

--import           Data.List.Split                       (chunksOf)

import BlockApps.Crossmon
import BlockApps.Logging
import qualified Blockchain.Bagger as Bagger
import qualified Blockchain.Bagger.BaggerState as B
import Blockchain.BlockChain
import Blockchain.Blockstanbul (PreprepareDecision(..))
import Blockchain.DB.CodeDB (getCode)
import Blockchain.DB.BlockSummaryDB
import Blockchain.Data.AddressStateDB (AddressState (..), CodePtr (..))
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import Blockchain.Data.ProposalFacts
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Event hiding (selfAddress)
import Blockchain.TraceReplay (runJsonRpcCommandTraced)
import Blockchain.Model.WrappedBlock
import Blockchain.PhaseProfile
import Blockchain.Sequencer.Event
import Blockchain.SolidVM.CodeCollectionDB (parseSource, prewarmCodeCollectionFromSource)
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Code (Code (..))
import qualified Blockchain.Strato.Model.Keccak256 as Keccak256
import Blockchain.Strato.Model.MicroTime
import Blockchain.VMContext
import Blockchain.VMMetrics
import Blockchain.EthConf (ethConf, networkConfig, quarryConfig)
import qualified Blockchain.EthConf.Model as Conf
import Conduit hiding (Flush)
import Control.Arrow ((&&&), (***))
import Control.Exception (evaluate)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import qualified Data.Aeson as Aeson
import qualified Data.ByteString.Lazy as BL
import Data.Foldable hiding (fold)
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import Data.Traversable (for)
import GHC.Conc (getNumCapabilities)
import Prometheus
import qualified Text.Colors as CL
import Text.Format (format)
import Text.Printf
import Text.Tools
import UnliftIO.Async (mapConcurrently_)

microtimeCutoff :: Microtime
microtimeCutoff = secondsToMicrotime (Conf.mempoolLivenessCutoff (quarryConfig ethConf))
{-# NOINLINE microtimeCutoff #-}

handleVmTasks ::
  (MonadFail m, Bagger.MonadBagger m, MonadMonitor m) =>
  ConduitT VmInEventBatch VmOutEvent m ()
handleVmTasks = awaitForever $ \InBatch {..} -> do
  mpResps <- lift $ for mpNodesReqs $ \(o, srs) -> do
    nds <- catMaybes <$> traverse (A.lookup (A.Proxy @MP.NodeData)) srs
    pure $! OutMPNodesResponse o nds
  yieldMany $! mpResps
  let toSR = MP.StateRoot . Keccak256.keccak256ToByteString . Keccak256.rlpHash
  lift . for_ mpNodesResps $ A.insertMany (A.Proxy @MP.NodeData) . M.fromList . map (toSR &&& id)

  rpcResps <- lift $ do
    bbHash <- do
      bbi <- getContextBestBlockInfo
      case bbi of
        ContextBestBlockInfo h _ _ -> pure h
        Unspecified -> pure Keccak256.zeroHash
    resps <- withCurrentBlockHashNoCommit bbHash $ traverse runJsonRpcCommandTraced rpcCommands
    recordSeqEventCount bLen tLen
    pure resps
  yieldMany $! OutJSONRPC <$> rpcResps

  numPoolable <- uncurry (*>) . (yieldMany *** pure) =<< lift (processTransactions txPairs)
  processBlocks blocks

  mPreDec <- lift $ do
    case preprepareBlock of
      Nothing -> pure Nothing
      Just block -> do
        let bHeader = blockBlockData block
            bHash = blockHeaderHash bHeader
            allTxs = blockReceiptTransactions block
            allWrapped = wrapIngestBlockTransaction bHash <$> allTxs
            otxs = catMaybes allWrapped
            droppedCount = length allTxs - length otxs
        when (droppedCount > 0) $
          $logWarnS "preprepare" . T.pack $
            "Dropped " ++ show droppedCount ++ " of " ++ show (length allTxs)
            ++ " tx(s) with unrecoverable signatures in preprepare block #"
            ++ show (number bHeader) ++ " (" ++ format bHash ++ ")"
        mSumm <- A.lookup (A.Proxy @BlockSummary) (parentHash bHeader)
        case mSumm of
          Nothing -> pure Nothing
          Just summ -> do
            let bHeader' = case bHeader of
                            -- imitate parent block as closely as possible (most important is the stateroot)
                            -- NOTE: Do NOT override `number` - transactions must see the actual block number
                            -- they're in, otherwise contracts that store block.number will produce different
                            -- state roots during validation vs creation.
                            BlockHeader {} -> bHeader {
                              parentHash = bSumParentHash summ,
                              stateRoot = bSumStateRoot summ,
                              gasLimit = bSumGasLimit summ
                            }
                            BlockHeaderV2 {} -> bHeader {
                              parentHash = bSumParentHash summ,
                              stateRoot = bSumStateRoot summ
                            }
                            -- NOTE: Do NOT override `parentHash` either - block.prevProposer /
                            -- block.prevIntendedProposer resolve the *parent's* BlockSummary
                            -- through this field. Pointing it at the grandparent makes any
                            -- transaction that reads them produce a different state root here
                            -- than the proposer and the authoritative replay computed, so the
                            -- proposal is rejected and the round changes forever.
                            BlockHeaderV3 {} -> bHeader {
                              stateRoot = bSumStateRoot summ
                            }
            proposer <- either error pure $ recoverProposer bHeader
            -- Verification always replays the whole block in one run, so it
            -- always has the block's first transaction to attach the rewards
            -- to; any leftover means the block has no transactions at all, and
            -- then the miner drops them too. Nothing to carry here.
            (_, res) <- Bagger.runFromStateRoot
              --account
              mineTransactions
              (bSumGasLimit summ)
              bHeader'
              otxs
              proposer
              -- Replays the whole block from the parent state root, so this run
              -- is the one that pays its rewards.
              True
            case res of
              Right (sr, trrs, _) -> do
                $logDebugS "handleVmEvents/preprepareBlock" . T.pack $ "Stateroot we got: " <> format sr
                $logDebugS "handleVmEvents/preprepareBlock" . T.pack $ "Stateroot in block: " <> format (stateRoot bHeader)
                blockFailures <- verifyBlock block (trrs, Just sr) summ
                case blockFailures of
                  [] -> pure . Just $ AcceptPreprepare bHash
                  _  -> do
                    $logDebugS "handleVmEvents/preprepareBlock" . T.pack $ show blockFailures
                    pure $ Just RejectPreprepare
              _ -> pure $ Just RejectPreprepare
  $logDebugS "handleVmEvents/mPreDec" . T.pack $ format mPreDec
  traverse_ (yield . OutPreprepareResponse) mPreDec

  mSelfAddress <- _selfAddress <$> Mod.get (Mod.Proxy @ContextState)
  mNewBlock <- lift $ do
    -- todo: perhaps we shouldnt even add TXs to the mempool, it might make for a VERY large checkpoint
    -- todo: which may fail
    bState <- Bagger.getBaggerState
    let pending = B.pending bState
        hasTxs = (numPoolable > 0) || not (M.null pending)
        shouldOutputBlocks = hasTxs
    $logInfoS "evm/loop/newBlock" . T.pack $
      printf
        "Num poolable: %d, num pending: %d"
        numPoolable
        (M.size pending)
    multilineLog "evm/loop/newBlock" $
      boringBox
        [ CL.yellow "Decision making for block creation:",
          "hasTxs: " ++ formatBool hasTxs,
          "shouldOutputBlocks: " ++ formatBool shouldOutputBlocks
        ]
    $logDebugS "evm/loop/newBlock" $ T.pack $ "Queued: " ++ show numPoolable
    $logDebugS "evm/loop/newBlock" $ T.pack $ "Pending: " ++ show (length pending)
    $logInfoS "evm/loop/newBlock" "about to evaluate shouldOutputBlocks"
    if shouldOutputBlocks
      then do
        $logInfoS "evm/loop/newBlock" "calling Bagger.makeNewBlock"
        newBlock <- Bagger.makeNewBlock mineTransactions mSelfAddress
        if not . null $ obReceiptTransactions newBlock
          then pure $ Just newBlock
          else pure Nothing
      else pure Nothing

  for_ mNewBlock $ yield . OutBlock

processBlocks ::
  (MonadFail m, Bagger.MonadBagger m, MonadMonitor m) =>
  [OutputBlock] ->
  ConduitT a VmOutEvent m ()
processBlocks blocks = do
  $logInfoS "evm/processBlocks" $ T.pack $ "Running " ++ show (length blocks) ++ " blocks"
  liftIO $ prewarmCreationSourceParses blocks
  lift $ prewarmExistingCallCodeCollections blocks
  liftIO $ prewarmCreationCodeCollections blocks
  processBlockSummaries blocks
  addBlocks blocks

-- Parsing contract source does not depend on chain state. An incoming VM batch
-- already contains future creations, so multi-capability nodes can populate the
-- normal bounded parse cache before the ordered import-resolution/execution
-- path reaches them. Parse failures are intentionally ignored here and are
-- reproduced by the authoritative compile at the original transaction.
prewarmCreationSourceParses :: [OutputBlock] -> IO ()
prewarmCreationSourceParses blocks = do
  capabilities <- getNumCapabilities
  when (capabilities > 1) $
    mapConcurrently_ prewarmOne . S.toList . S.fromList $
      [ sourceEntry
      | block <- blocks,
        tx <- obReceiptTransactions block,
        Code source <- maybeToList $ txCode (otBaseTx tx),
        sourceEntry <- sourceFiles source
      ]
  where
    prewarmOne (fileName, source) =
      void . evaluate $
        case parseSource fileName source of
          Left _ -> ()
          Right _ -> ()

    sourceFiles source =
      M.toList . M.fromList $
        case Aeson.decode bytes of
          Just sourceList -> sourceList
          Nothing ->
            case Aeson.decode bytes of
              Just sourceMap -> M.toList sourceMap
              Nothing -> [(T.empty, source)]
      where
        bytes = BL.fromStrict $ TE.encodeUtf8 source

-- Compilation after parsing is also pure for self-contained source bundles.
-- Prewarm those bundles in parallel and leave creations with address/external
-- imports to the authoritative ordered compiler.
prewarmCreationCodeCollections :: [OutputBlock] -> IO ()
prewarmCreationCodeCollections blocks = do
  capabilities <- getNumCapabilities
  when (capabilities > 1) $
    mapConcurrently_ (prewarmCodeCollectionFromSource False True . TE.encodeUtf8)
      . S.toList . S.fromList $
        [ source
        | block <- blocks,
          tx <- obReceiptTransactions block,
          Code source <- maybeToList $ txCode (otBaseTx tx)
        ]

-- Existing top-level call destinations are already known at the start of a
-- batch. Read their canonical source from the ordered snapshot, then perform
-- only self-contained compilation in parallel. Calls to contracts created in
-- this same batch, and sources with live-state imports, safely fall through.
prewarmExistingCallCodeCollections :: Bagger.MonadBagger m => [OutputBlock] -> m ()
prewarmExistingCallCodeCollections blocks = do
  payloads <- fmap catMaybes . for destinations $ \address ->
    A.lookup (A.Proxy @AddressState) address >>= \case
      Just AddressState {addressStateCodeHash = SolidVMCode _ hsh} -> getCode hsh
      _ -> pure Nothing
  liftIO . mapConcurrently_ (prewarmCodeCollectionFromSource False True) $ payloads
  where
    destinations = S.toList . S.fromList $
      [ address
      | block <- blocks,
        tx <- obReceiptTransactions block,
        address <- maybeToList $ txDestination (otBaseTx tx)
      ]

processBlockSummaries ::
  ( MonadIO m,
    MonadLogger m,
    HasBlockSummaryDB m
  ) =>
  [OutputBlock] ->
  m ()
processBlockSummaries = mapM_ $ \b -> do
  let number' = number $ obBlockData b
      txCount = length $ obReceiptTransactions b
  recordMaxBlockNumber "vm_seqevents" number'
  $logDebugS "evm/processBlockSummaries" . T.pack $
    concat
      [ "Received block number ",
        show number',
        " with ",
        show txCount,
        " transactions from seqEvents"
      ]
  writeBlockSummary b

processTransactions ::
  ( Bagger.MonadBagger m
  ) =>
  [(Timestamp, OutputTx)] ->
  m ([VmOutEvent], Int)
processTransactions = uncurry (fmap . (,)) . (outputTransactions &&& getNumPoolable)

getNumPoolable ::
  ( Bagger.MonadBagger m
  ) =>
  [(Timestamp, OutputTx)] ->
  m Int
getNumPoolable txPairs = do
  $logDebugS "evm/getNumPoolable" $ T.pack $ "allTxs :: " ++ show txPairs
  let allNewTxs = txPairs -- PrivateHashTXs have chainId = Nothing
  !currentMicrotime <- liftIO getCurrentMicrotime
  $logInfoS "evm/getNumPoolable" $ T.pack $ "currentMicrotime :: " ++ show currentMicrotime

  forM_ allNewTxs $ \(ts, _) ->
    $logInfoS "evm/getNumPoolable/allNewTxs" $ T.pack $ "math :: " ++ show currentMicrotime ++ " - " ++ show ts ++ " = " ++ show (currentMicrotime - ts) ++ "; <= " ++ show microtimeCutoff ++ "? " ++ show ((currentMicrotime - ts) <= microtimeCutoff)
  let !poolableNewTxs = [t | (ts, t) <- allNewTxs, abs (currentMicrotime - ts) <= microtimeCutoff]
  $logInfoS "evm/loop" (T.pack ("adding " ++ show (length poolableNewTxs) ++ "/" ++ show (length allNewTxs) ++ " txs to mempool"))
  unless (null poolableNewTxs) $ Bagger.addTransactionsToMempool poolableNewTxs
  return $ length poolableNewTxs

outputTransactions :: [(Timestamp, OutputTx)] -> [VmOutEvent]
outputTransactions = map $ OutIndexEvent . uncurry IndexTransaction

writeBlockSummary :: (MonadIO m, HasBlockSummaryDB m) => OutputBlock -> m ()
writeBlockSummary block =
  profileDetachedPhase (number $ obBlockData block) BlockSetupHeaderParentProposer $ do
    let sha = outputBlockHash block
        header = obBlockData block
        txCnt = fromIntegral $ length (obReceiptTransactions block)
    -- the parent's facts carry the round this height started at (none for genesis / legacy parents)
    parentFacts <- maybe noProposalFacts bSumProposalFacts <$> A.lookup (A.Proxy @BlockSummary) (parentHash header)
    putBSum sha (blockHeaderToBSum (Conf.networkID (networkConfig ethConf)) parentFacts header txCnt)
