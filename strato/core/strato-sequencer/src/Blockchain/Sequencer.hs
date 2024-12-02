{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-incomplete-uni-patterns #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Sequencer (
  sequencer
  ) where

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Blockstanbul 
import qualified Blockchain.Data.Block as BDB
import Blockchain.Data.BlockHeader
import qualified Blockchain.Data.TXOrigin as TO
import qualified Blockchain.Data.TransactionDef as TD
import Blockchain.Sequencer.DB.DependentBlockDB
import Blockchain.Sequencer.DB.GetTransactionsDB
import Blockchain.Sequencer.DB.SeenTransactionDB
import Blockchain.Sequencer.DB.Witnessable
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.Sequencer.Metrics
import Blockchain.Sequencer.Monad
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class as BDB
import Blockchain.Strato.Model.Keccak256
import Conduit
import Control.Concurrent hiding (yield)
import Control.Monad (forever, forM, unless, when)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Kafka
import Control.Monad.State.Class
import Data.Foldable
import Data.Maybe
import Data.Proxy
import Data.Sequence (Seq)
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Time.Clock
import Database.LevelDB.Types
import Prometheus as P
import Text.Format
import Text.Printf

instance MonadMonitor m => MonadMonitor (ConduitT i o m) where
  doIO = lift . doIO

instance Mod.Modifiable r m => Mod.Modifiable r (ConduitT i o m) where
  get = lift . Mod.get
  put p = lift . Mod.put p

instance (Monad m, Mod.Accessible r m) => Mod.Accessible r (ConduitT i o m) where
  access = lift . Mod.access

instance (k `A.Alters` v) m => (k `A.Alters` v) (ConduitT i o m) where
  lookup p = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p = lift . A.delete p

instance (A.Selectable k v m) => A.Selectable k v (ConduitT i o m) where
  select p = lift . A.select p

instance HasBlockstanbulContext m => HasBlockstanbulContext (ConduitT i o m) where
  getBlockstanbulContext = lift getBlockstanbulContext
  putBlockstanbulContext = lift . putBlockstanbulContext

logFF :: MonadLogger m => T.Text -> String -> m ()
logFF str = $logInfoS str . T.pack

-- replace with this when debugging tests
--logFF str msg = void . return $! traceShowId $! trace (T.unpack str) msg

type MonadSequencer m =
  ( MonadLogger m,
    MonadMonitor m,
    MonadBlockstanbul m,
    (Keccak256 `A.Alters` DependentBlockEntry) m,
    (Keccak256 `A.Alters` ()) m
  )

sequencer :: SequencerM ()
sequencer = do
  let logF = logFF "sequencer"
  hasPBFT <- isJust <$> getBlockstanbulContext
  when (hasPBFT) $ do
    ctx <- fromJust <$> getBlockstanbulContext
    let selfAddr = fromJust $ _selfAddr ctx
    _ <- writeSeqVmEvents [VmSelfAddress selfAddr]
    -- check checkpoint in ldb
    mChckpt <- A.lookup (A.Proxy @Checkpoint) ()
    ctx' <- case mChckpt of 
      Just (Checkpoint v vals) -> do 
        return ctx { _view = v, _validators = S.fromList vals}
      Nothing -> return ctx
    -- check for own cert and if val
    maybeCert <- A.lookup (A.Proxy @X509CertInfoState) selfAddr
    ctx'' <- case maybeCert of
      Just cert -> do
        let chainm = getChainMemberFromX509 cert
        logF $ "Node identity verified: " ++ show chainm
        case chainMemberParsedSetToValidator chainm `S.member` _validators ctx' of
          True -> do
            logF "You are a validator in this network!"
            return ctx' { _selfCert = Just chainm, _isValidator = True }
          False -> return ctx' { _selfCert = Just chainm }
      Nothing -> do
        logF "Awaiting node identity verification..."
        return ctx'
    putBlockstanbulContext ctx''
  logF "Sequencer startup"
  source <- fuseChannels
  bootstrapBlockstanbul
  logF "Sequencer initialized"
  flush
  runConduit $ source .| oneSequencerIter

oneSequencerIter :: (
                     MonadFail m,
                     HasKafka m,
                     HasDependentBlockDB m,
                     Mod.Modifiable GetTransactionsDB m,
                     MonadSequencer m,
                     Mod.Modifiable (Seq BatchOp) m,
                     (() `A.Alters` Checkpoint) m,
                     MonadState SequencerContext m
                    ) =>
                    ConduitT SeqLoopEvent Void m ()
oneSequencerIter = forever $ timeAction seqLoopTiming $ do
  logFF "sequencer/events" "Reading from fused channels..."
  maybeEvent <- await
  let event = fromMaybe (error "input stream to sequencer closed, this shouldn't happen") maybeEvent

  $logDebugS "sequencer/events" . T.pack $ format event

  runSequencerBatch [event]
  txHashes <- unGetTransactionsDB <$> Mod.get (Mod.Proxy @GetTransactionsDB)
  let txHashesList = toList txHashes
      getTxs = if null txHashesList then [] else [P2pGetTx txHashesList]

  lift flushLdbBatchOps

  unless (null getTxs) $ do
    _ <- writeSeqP2pEvents getTxs
    return ()
  flush

flush :: (Mod.Modifiable GetTransactionsDB m, MonadState SequencerContext m) =>
         m ()
flush =
  clearDBERegistry
    >> clearGetTransactionsDB

runSequencerBatch ::
  (MonadSequencer m,
   HasKafka m,
   (() `A.Alters` Checkpoint) m) =>
  [SeqLoopEvent] -> m ()
runSequencerBatch events = do
  let BatchSeqLoopEvent {..} = batchSeqLoopEvents events
  checkForTimeouts _timerFires
  forM_ _ingestEvents checkForUnseq

checkForTimeouts ::
  ( MonadLogger m,
    MonadMonitor m,
    MonadBlockstanbul m,
    (Keccak256 `A.Alters` DependentBlockEntry) m,
    (() `A.Alters` Checkpoint) m,
    HasKafka m
  ) =>
  [RoundNumber] -> m ()
checkForTimeouts rns = do
  withLabel seqLoopEvents "timeout" (flip unsafeAddCounter . fromIntegral . length $ rns)
  blockstanbulSend . map Timeout $ rns

checkForUnseq ::
  ( MonadSequencer m, 
    (() `A.Alters` Checkpoint) m,
    HasKafka m) =>
  [IngestEvent] -> m ()
checkForUnseq inEvents = do
  withLabel seqLoopEvents "unseq" (flip unsafeAddCounter . fromIntegral . length $ inEvents)
  timeAction seqSplitEventsTiming $ splitEvents inEvents

bootstrapBlockstanbul :: (MonadBlockstanbul m, Mod.Accessible View m, HasKafka m) =>
                         m ()
bootstrapBlockstanbul = do
  _ <- writeSeqVmEvents [VmCreateBlockCommand]
  createFirstTimer

blockstanbulSend ::
  ( MonadLogger m,
    MonadBlockstanbul m,
    (Keccak256 `A.Alters` DependentBlockEntry) m,
    (() `A.Alters` Checkpoint) m,
    HasKafka m
  ) =>
  [InEvent] -> m ()
blockstanbulSend = mapM_ $ \ie -> do
      blockstanbulSend' ie

blockstanbulSend' ::
  ( MonadLogger m,
    MonadBlockstanbul m,
    (Keccak256 `A.Alters` DependentBlockEntry) m,
    (() `A.Alters` Checkpoint) m,
    HasKafka m
  ) =>
  InEvent -> m ()
blockstanbulSend' msg = do
  resp <- sendAllMessages [msg]
  let blocks = [b | ToCommit b <- resp]
  for_ resp $ \case
    ResetTimer rn -> createNewTimer rn
    FailedHistoric blk -> A.delete (Proxy @DependentBlockEntry) (blockHash blk) -- First time using `delete`
    _ -> pure ()
  $logDebugS "seq/pbft/send" . T.pack $ "Pre-rewrite: " ++ format (blockHash <$> blocks)

  let getSequencedBlock =
        ingestBlockToSequencedBlock
          . blockToIngestBlock TO.Blockstanbul
      creates = [VmCreateBlockCommand | MakeBlockCommand <- resp]
  let rBlocks = catMaybes (map getSequencedBlock blocks)
  committedBlocks <- catMaybes <$> traverse insertEmitted rBlocks
  let (vms, p2ps, ckpts) = vmEvenP2pCheckptFilterHelper resp

  let vmevs =
        creates
          ++ (VmBlock <$> committedBlocks)
          ++ vms
  let p2pevs =
        (P2pBlock <$> committedBlocks)
          ++ p2ps

  case committedBlocks of
    [] -> pure ()
    (b:_) -> do
      let bh = BDB.blockHeader b
          tLast = blockHeaderTimestamp bh
      dt <- unBlockPeriod <$> Mod.access (Mod.Proxy @BlockPeriod)
      let tNext = addUTCTime dt tLast
      now <- liftIO getCurrentTime
      when (now < tNext) $
        liftIO . threadDelay . round $ 1e6 * diffUTCTime tNext now
      Mod.put (Mod.Proxy @BDB.BestSequencedBlock) . BDB.BestSequencedBlock $
        BDB.BestBlock (BDB.blockHeaderHash bh) (BDB.blockHeaderBlockNumber bh)

  $logDebugS "seq/pbft/send_checkpoints" . T.pack $ show ckpts
  forM_ ckpts (A.insert (A.Proxy @Checkpoint) ())
  $logDebugS "seq/pbft/send_p2p" . T.pack $ format p2pevs
  _ <- writeSeqP2pEvents p2pevs
  $logDebugS "seq/pbft/send_vm" . T.pack $ format vmevs
  _ <- writeSeqVmEvents vmevs
  return ()
  where
    vmEvenP2pCheckptFilterHelper :: [OutEvent] -> ([VmEvent], [P2pEvent], [Checkpoint])
    vmEvenP2pCheckptFilterHelper (x : xs) = do
      let (vms, p2ps, ctxs) = vmEvenP2pCheckptFilterHelper xs
      case x of
        OMsg a m -> (vms, P2pBlockstanbul (WireMessage a m) : p2ps, ctxs)
        GapFound h l p -> (vms, (P2pAskForBlocks (h + 1) l p) : p2ps, ctxs)
        LeadFound h l p -> (vms, (P2pPushBlocks (l + 1) h p) : p2ps, ctxs)
        NewCheckpoint ck -> (vms, p2ps, ck : ctxs)
        RunPreprepare b -> (VmRunPreprepare b : vms, p2ps, ctxs)
        _ -> (vms, p2ps, ctxs)
    vmEvenP2pCheckptFilterHelper [] = ([], [], [])

transformFullTransactions ::
  ( MonadLogger m,
    MonadMonitor m,
    (Keccak256 `A.Alters` ()) m,
    HasKafka m
  ) =>
  [(Timestamp, IngestTx)] -> m ()
transformFullTransactions pairs = do
  let logF = logFF "transformEvents/emitTxs"
  mOtxs <- forM pairs $ \(ts, itx) ->
    wrapTransaction itx >>= \case
      Nothing -> return Nothing
      Just otx -> do
        let witnessHash = witnessableHash otx
        wasTransactionHashWitnessed witnessHash >>= \case
          True -> do
            logF $ "Already witnessed " ++ prettyTx itx
            P.incCounter seqTxsWitnessed
            return Nothing
          False -> do
            logF $ "Haven't witnessed " ++ prettyTx itx
            witnessTransactionHash witnessHash
            P.incCounter seqTxsUnwitnessed
            return $ Just (ts, otx)

            
  let txs = catMaybes mOtxs
  logF $ "Sending " ++ show (length txs) ++ " public transactions to P2P and the VM"
  _ <- writeSeqVmEvents $ map pairToVmTx txs
  _ <- writeSeqP2pEvents $ map (P2pTx . snd) txs
  return ()

expandBlock ::
  ( MonadLogger m,
    MonadMonitor m,
    (Keccak256 `A.Alters` DependentBlockEntry) m
  ) =>
  SequencedBlock -> m [OutputBlock]
expandBlock sb = do
  readiness <- enqueueIfParentNotEmitted sb
  case readiness of
    NotReadyToEmit -> do
      $logWarnS "expandBlock" . T.pack $ prettyBlock sb ++ " is not yet ready to emit."
      P.incCounter seqBlocksEnqueued
      return []
    ReadyToEmit -> do
      -- TODO: buildEmissionChain needs to do all of this so that we don't emit blocks missing transactions prematurely
      dryChain <- buildEmissionChain sb
      if dryChain /= []
        then do
          $logInfoS "expandBlock" . T.pack $ prettyBlock sb ++ " is ready to emit! Emitting it and chain of dependents."
          return dryChain
        else do
          $logInfoS "expandBlock" . T.pack $ prettyBlock sb ++ " is ready to emit, but its emission chain is empty. It was likely already emitted."
          return []

runConsensus ::
  ( MonadLogger m,
    MonadMonitor m,
    MonadBlockstanbul m,
    (Keccak256 `A.Alters` DependentBlockEntry) m,
    (() `A.Alters` Checkpoint) m,
    HasKafka m
  ) =>
  SequencedBlock -> m ()
runConsensus sb = do
  hasPBFT <- blockstanbulRunning
  if not hasPBFT
    then do
      obs <- expandBlock sb
      flip traverse_ obs $ \ob -> do
        _ <- writeSeqP2pEvents [P2pBlock ob]
        return ()
      _ <- writeSeqVmEvents $ map VmBlock obs
      return ()
    else do
      let blk = sequencedBlockToBlock sb
      routed <-
        if isHistoricBlock blk
          then map (PreviousBlock . outputBlockToBlock) <$> expandBlock sb
          else pure [UnannouncedBlock blk]
      -- Blockstanbul will check that the seals and validators match up before
      -- announcing it to the network or forwarding to the EVM.
      traverse_ blockstanbulSend' routed

transformBlocks ::
  ( MonadLogger m,
    MonadMonitor m,
    MonadBlockstanbul m,
    (Keccak256 `A.Alters` DependentBlockEntry) m,
    (() `A.Alters` Checkpoint) m,
    HasKafka m
  ) =>
  [IngestBlock] -> m ()
-- ingestBlockToSequencedBlock :: IngestBlock -> Maybe SequencedBlock
-- forM_ :: (Foldable t, Monad m) => t a -> (a -> m b) -> m ()
transformBlocks ibs = do
  forM_ ibs $ \ib ->
    case (ingestBlockToSequencedBlock ib) of
      Nothing -> do
        $logWarnS "transformEvents/emitBlocks" . T.pack $
          "Could not ECRecover the pubkey of certain Txs in Block " ++ prettyIBlock ib ++ "; not emitting"
        P.incCounter seqBlocksEcrfail -- couldnt ecrecover some transactions in this block. block is likely garbage
      Just sb -> do
        runConsensus sb

splitEvents ::
  ( MonadLogger m,
    MonadMonitor m,
    MonadBlockstanbul m,
    (Keccak256 `A.Alters` DependentBlockEntry) m,
    (Keccak256 `A.Alters` ()) m,
    (() `A.Alters` Checkpoint) m,
    HasKafka m
  ) =>
  [IngestEvent] -> m ()
splitEvents es = forM_ (splitWith iEventType es) $ \(eventType, events) ->
  let num = length events
      record :: (MonadIO m, MonadLogger m) => T.Text -> T.Text -> m ()
      record t k = do
        liftIO $ withLabel eventsplitMetrics t (flip unsafeAddCounter . fromIntegral $ num)
        $logInfoS "splitEvents" . T.pack $ printf "Running %d %s" num k
   in case eventType of
        IETTransaction -> do
          record "inevent_type_transaction" "IngestTransactions"
          transformFullTransactions $ map (\(IETx ts tx) -> (ts, tx)) events
        IETBlock -> do
          record "inevent_type_block" "IngestBlocks"
          transformBlocks $ map (\(IEBlock ob) -> ob) events
        IETBlockstanbul -> do
          record "inevent_type_blockstanbul" "IngestBlockstanbuls"
          blockstanbulSend $ map (\(IEBlockstanbul (WireMessage a m)) -> IMsg a m) events
        IETForcedConfigChange -> do
          record "inevent_type_forced_config_change" "ForcedConfigChanges"
          blockstanbulSend $ map (\(IEForcedConfigChange cc) -> ForcedConfigChange cc) events
        IETValidatorBehavior -> do
          record "inevent_type_validator_behavior" "ValidatorBehaviorChange"
          blockstanbulSend $ map (\(IEValidatorBehavior vc) -> ValidatorBehaviorChange vc) events
        IETDeleteDepBlock -> do
          record "inevent_type_delete_dep_block" "DeleteDepBlock"
          traverse_ (\(IEDeleteDepBlock k) -> A.delete (A.Proxy @DependentBlockEntry) k) events
        IETGetMPNodes -> do
          record "inevent_type_get_mp_nodes" "GetMPNodes"
          _ <- writeSeqP2pEvents $ map (\(IEGetMPNodes srs) -> P2pGetMPNodes srs) events
          return ()
        IETGetMPNodesRequest -> do
          record "inevent_type_get_mp_nodes_request" "GetMPNodesRequest"
          _ <- writeSeqVmEvents $ map (\(IEGetMPNodesRequest o srs) -> VmGetMPNodesRequest o srs) events
          return ()
        IETMPNodesResponse -> do
          record "inevent_type_mp_nodes_response" "MPNodesResponse"
          _ <- writeSeqP2pEvents $ map (\(IEMPNodesResponse o nds) -> P2pMPNodesResponse o nds) events
          return ()
        IETMPNodesReceived -> do
          record "inevent_type_mp_nodes_received" "MPNodesReceived"
          _ <- writeSeqVmEvents $ map (\(IEMPNodesReceived nds) -> VmMPNodesReceived nds) events
          return ()
        IETPreprepareResponse -> do
          record "inevent_type_preprepare_response" "PreprepareResponse"
          blockstanbulSend $ map (\(IEPreprepareResponse decis) -> PreprepareResponse decis) events

prettyIBlock :: IngestBlock -> String
prettyIBlock IngestBlock {ibOrigin = o, ibBlockData = bd, ibReceiptTransactions = txs} = "Block #" ++ blockNonce ++ "/" ++ bHash ++ " (via " ++ format o ++ ", " ++ show (length txs) ++ " txs)"
  where
    blockNonce = show . number $ bd
    bHash = format . BDB.blockHeaderHash $ bd

prettyBlock :: SequencedBlock -> String
prettyBlock SequencedBlock {sbOrigin = o, sbBlockData = bd, sbReceiptTransactions = txs} = "Block #" ++ blockNonce ++ "/" ++ bHash ++ " (via " ++ format o ++ ", " ++ show (length txs) ++ " txs)"
  where
    blockNonce = show . number $ bd
    bHash = format . blockHeaderHash $ bd

prettyTx :: IngestTx -> String
prettyTx IngestTx {itOrigin = o, itTransaction = t} = prefix t ++ " via " ++ shortOrigin o
  where
    prefix TD.MessageTX {} = "MessageTx [" ++ (format $ txHash t) ++ "]"
    prefix TD.ContractCreationTX {} = "CreationTx[" ++ (format $ txHash t) ++ "]"
    prefix TD.PrivateHashTX {} = "PrivateHashTx[" ++ (format $ txHash t) ++ "]"

    shortOrigin (TO.PeerString peer) = "Peer " ++ take 8 peer
    shortOrigin x = format x

splitWith :: Eq k => (a -> k) -> [a] -> [(k, [a])]
splitWith f = foldr agg []
  where
    agg a [] = [(f a, [a])]
    agg a kas@((k, as) : kas') =
      let fa = f a
       in if fa == k
            then (k, a : as) : kas'
            else (fa, [a]) : kas
