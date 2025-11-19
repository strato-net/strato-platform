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
  ( handleVmEvents,
    writeBlockSummary,
  )
where

--import           Data.List.Split                       (chunksOf)

import BlockApps.Crossmon
import BlockApps.Logging
import qualified Blockchain.Bagger as Bagger
import qualified Blockchain.Bagger.BaggerState as B
import Blockchain.BlockChain
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.Blockstanbul (PreprepareDecision(..))
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.ChainDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Event hiding (selfAddress)
import Blockchain.JsonRpcCommand
import Blockchain.Model.WrappedBlock
import Blockchain.Sequencer.Event
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Class
import qualified Blockchain.Strato.Model.Keccak256 as Keccak256
import Blockchain.Strato.Model.MicroTime
import Blockchain.VMContext
import Blockchain.VMMetrics
import Conduit hiding (Flush)
import Control.Arrow ((&&&), (***))
import Control.Lens hiding (Context)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Data.Foldable hiding (fold)
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Text as T
import Data.Traversable (for)
import Executable.EVMFlags
import Prometheus
import qualified Text.Colors as CL
import Text.Format (format)
import Text.Printf
import Text.Tools

microtimeCutoff :: Microtime
microtimeCutoff = secondsToMicrotime flags_mempoolLivenessCutoff
{-# NOINLINE microtimeCutoff #-}

handleVmEvents ::
  (MonadFail m, Bagger.MonadBagger m, MonadMonitor m) =>
  ConduitT VmInEventBatch VmOutEvent m ()
handleVmEvents = awaitForever $ \InBatch {..} -> do
  mpResps <- lift $ for mpNodesReqs $ \(o, srs) -> do
    nds <- catMaybes <$> traverse (A.lookup (A.Proxy @MP.NodeData)) srs
    pure $! OutMPNodesResponse o nds
  yieldMany $! mpResps
  let toSR = MP.StateRoot . Keccak256.keccak256ToByteString . Keccak256.rlpHash
  lift . for_ mpNodesResps $ A.insertMany (A.Proxy @MP.NodeData) . M.fromList . map (toSR &&& id)

  rpcResps <- lift $ do
    bbHash <- maybe Keccak256.zeroHash fst <$> getChainBestBlock Nothing
    resps <- withCurrentBlockHash bbHash $ traverse runJsonRpcCommand' rpcCommands
    recordSeqEventCount bLen tLen
    pure resps
  yieldMany $! uncurry OutJSONRPC <$> rpcResps

  numPoolable <- uncurry (*>) . (yieldMany *** pure) =<< lift (processTransactions txPairs)
  processBlocks blocks


  mPreDec <- lift $ do
    case preprepareBlock of
      Nothing -> pure Nothing
      Just block -> do
        let bHeader = blockBlockData block
            bHash = blockHeaderHash bHeader
            -- bro if there are any maybes in this list thaz BAD
            -- private txs don't affect stateroot we compute
            otxs = catMaybes $ wrapIngestBlockTransaction  bHash <$> [t | t <- blockReceiptTransactions block]
        mSumm <- A.lookup (A.Proxy @BlockSummary) (parentHash bHeader)
        case mSumm of
          Nothing -> pure Nothing
          Just summ -> do
            let bHeader' = case bHeader of
                            -- imitate parent block as closely as possible (most important is the stateroot)
                            BlockHeader {} -> bHeader {
                              parentHash = bSumParentHash summ,
                              stateRoot = bSumStateRoot summ,
                              number = bSumNumber summ,
                              gasLimit = bSumGasLimit summ
                            }
                            BlockHeaderV2 {} -> bHeader {
                              parentHash = bSumParentHash summ,
                              stateRoot = bSumStateRoot summ,
                              number = bSumNumber summ
                            }
            let pHash = proposalHash bHeader
                mSig = getProposerSeal bHeader  -- Signature is Maybe type
            proposer <- case mSig of
                            Just sig -> do
                                let (r, s, v) = getSigVals sig
                                    proposerAddress = whoReallySignedThisTransactionEcrecover pHash r s (v - 0x1b)
                                case proposerAddress of
                                  Just addr ->  return addr
                                  Nothing -> error "no proposer"
                            Nothing -> error "no proposer"
            res <- Bagger.runFromStateRoot
              --account
              mineTransactions
              (bSumGasLimit summ)
              bHeader'
              otxs
              proposer
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
    Mod.modify_ (Mod.Proxy @ContextState) $ pure . (blockRequested ||~ createBlock)
    -- todo: perhaps we shouldnt even add TXs to the mempool, it might make for a VERY large checkpoint
    -- todo: which may fail
    bState <- Bagger.getBaggerState
    pbft <- _hasBlockstanbul <$> Mod.get (Mod.Proxy @ContextState)
    reqd <- _blockRequested <$> Mod.get (Mod.Proxy @ContextState)
    let makeLazyBlocks = False --lazyBlocks $ quarryConfig ethConf -- TODO?: Remove reference to ethConf
        pending = B.pending bState
        priv = toList . B.privateHashes $ B.miningCache bState
        hasTxs = (numPoolable > 0) || not (M.null pending) || not (null priv)
        shouldOutputBlocks =
          if pbft
            then reqd && hasTxs
            else not makeLazyBlocks || hasTxs
    $logInfoS "evm/loop/newBlock" . T.pack $
      printf
        "Num poolable: %d, num pending: %d"
        numPoolable
        (M.size pending)
    multilineLog "evm/loop/newBlock" $
      boringBox
        [ CL.yellow "Decision making for block creation:",
          "pbft: " ++ formatBool pbft,
          "reqd: " ++ formatBool reqd,
          "hasTxs: " ++ formatBool hasTxs,
          "makeLazyBlocks: " ++ formatBool makeLazyBlocks,
          "shouldOutputBlocks: " ++ formatBool shouldOutputBlocks
        ]
    when (pbft && shouldOutputBlocks) $
      Mod.modify_ (Mod.Proxy @ContextState) $ pure . (blockRequested .~ False)
    $logDebugS "evm/loop/newBlock" $ T.pack $ "Queued: " ++ show numPoolable
    $logDebugS "evm/loop/newBlock" $ T.pack $ "Pending: " ++ show (length pending)
    $logInfoS "evm/loop/newBlock" "about to evaluate shouldOutputBlocks"
    if shouldOutputBlocks
      then do
        $logInfoS "evm/loop/newBlock" "calling Bagger.makeNewBlock"
        newBlock <- Bagger.makeNewBlock mineTransactions mSelfAddress
        pure $ Just newBlock
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
writeBlockSummary block =
  let sha = outputBlockHash block
      header = obBlockData block
      txCnt = fromIntegral $ length (obReceiptTransactions block)
   in putBSum sha (blockHeaderToBSum header txCnt)

