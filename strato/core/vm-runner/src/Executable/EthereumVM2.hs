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
  )
where

--import           Data.List.Split                       (chunksOf)

import BlockApps.Crossmon
import BlockApps.Logging
import qualified Blockchain.Bagger as Bagger
import qualified Blockchain.Bagger.BaggerState as B
import Blockchain.BlockChain
import Blockchain.Blockstanbul (PreprepareDecision(..))
import Blockchain.DB.BlockSummaryDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import Blockchain.Data.ProposalFacts
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Event hiding (selfAddress)
import Blockchain.TraceReplay (runJsonRpcCommandTraced)
import Blockchain.Model.WrappedBlock
import Blockchain.Sequencer.Event
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Class
import qualified Blockchain.Strato.Model.Keccak256 as Keccak256
import Blockchain.Strato.Model.MicroTime
import Blockchain.VMContext
import Blockchain.VMMetrics
import Blockchain.EthConf (ethConf, networkConfig, quarryConfig)
import qualified Blockchain.EthConf.Model as Conf
import Conduit hiding (Flush)
import Control.Arrow ((&&&), (***))
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Data.Foldable hiding (fold)
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Text as T
import Data.Traversable (for)
import Prometheus
import qualified Text.Colors as CL
import Text.Format (format)
import Text.Printf
import Text.Tools

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
            res <- Bagger.runFromStateRoot
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
  processBlockSummaries blocks
  addBlocks blocks

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

writeBlockSummary :: HasBlockSummaryDB m => OutputBlock -> m ()
writeBlockSummary block = do
  let sha = outputBlockHash block
      header = obBlockData block
      txCnt = fromIntegral $ length (obReceiptTransactions block)
  -- the parent's facts carry the round this height started at (none for genesis / legacy parents)
  parentFacts <- maybe noProposalFacts bSumProposalFacts <$> A.lookup (A.Proxy @BlockSummary) (parentHash header)
  putBSum sha (blockHeaderToBSum (Conf.networkID (networkConfig ethConf)) parentFacts header txCnt)

