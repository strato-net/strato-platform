{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Sequencer (
  sequencer,
  eventHandler
  ) where

import BlockApps.Logging
import Blockchain.Blockstanbul
import Blockchain.Data.BlockHeader
import qualified Blockchain.Data.TXOrigin as TO
import qualified Blockchain.Data.TransactionDef as TD
import Blockchain.DB.Witnessable
import Blockchain.Model.SyncState
import Blockchain.Model.WrappedBlock
import Blockchain.Sequencer.DB.DependentBlockDB
import Blockchain.Sequencer.DB.SeenTransactionDB
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.Sequencer.Metrics
import Blockchain.Sequencer.Monad
import Blockchain.Strato.Model.Class as BDB
import Blockchain.Strato.Model.Keccak256
import Conduit
import Control.Concurrent hiding (yield)
import Control.Monad (forever, forM, when)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Kafka
import Data.Foldable
import Data.Maybe
import Data.Proxy
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Time.Clock
import Prometheus as P
import Text.Format
import Text.Printf

type SeqOutEvent = Either [P2pEvent] [VmEvent]

instance MonadMonitor m => MonadMonitor (ConduitT i o m) where
  doIO = lift . doIO

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

-- | Main sequencer pipeline.
--
-- The sequencer is a simple pipeline that:
-- 1. Fetches events from two sources (Kafka 'unseqevents' topic and Blockstanbul timers),
--    unified via the coproduct 'SeqLoopEvent' (either 'TimerFire' or 'UnseqEvents')
-- 2. Transforms 'SeqLoopEvent' to 'SeqOutEvent' via 'eventHandler'
-- 3. Writes 'SeqOutEvent' back to Kafka ('seq_vm_events' and 'seq_p2p_events' topics)
--
-- @
-- [fuseChannels]        →        [eventHandler]        →        [writeToKafka]
--      ↓                              ↓                              ↓
-- SeqLoopEvent                 SeqLoopEvent → SeqOutEvent        SeqOutEvent
-- (TimerFire | UnseqEvents)    (transformation)                  (to Kafka)
-- @
--
-- Note: 'initSequencer' runs before the main loop to yield initial events (e.g., 'VmSelfAddress').
sequencer :: SequencerM ()
sequencer = fuseChannels >>= \source -> runConduit $ (initSequencer >> (source .| eventHandler)) .| writeToKafka

initSequencer :: (
  MonadFail m,
  MonadSequencer m,
  Mod.Accessible View m
  ) =>
  ConduitT () SeqOutEvent m ()
initSequencer = do
  let logF = logFF "sequencer"
  lift getBlockstanbulContext >>= \case
    Nothing -> pure ()
    Just ctx -> do
      let selfAddr = fromJust $ _selfAddr ctx
      yield $ Right [VmSelfAddress selfAddr]
  logF "Sequencer startup"
  logF "Sequencer initialized"
  bootstrapBlockstanbul

writeToKafka :: (
  MonadFail m,
  MonadSequencer m,
  HasKafka m
  ) =>
  ConduitT SeqOutEvent Void m ()
writeToKafka = awaitForever $ either writeSeqP2pEvents writeSeqVmEvents

eventHandler :: (
  MonadFail m,
  MonadSequencer m
  ) =>
  ConduitT SeqLoopEvent SeqOutEvent m ()
eventHandler = forever $ timeAction seqLoopTiming $ do
  logFF "sequencer/events" "Reading from fused channels..."
  maybeEvent <- await
  let event = fromMaybe (error "input stream to sequencer closed, this shouldn't happen") maybeEvent

  $logDebugS "sequencer/events" . T.pack $ format event

  case event of
    TimerFire roundNumber -> do
      withLabel seqLoopEvents "timeout" (flip unsafeAddCounter 1)
      blockstanbulSend [Timeout roundNumber]
    UnseqEvents unseqEvents -> do
      withLabel seqLoopEvents "unseq" (flip unsafeAddCounter . fromIntegral . length $ unseqEvents)
      timeAction seqSplitEventsTiming $ unseqEventHandler unseqEvents

unseqEventHandler ::
  ( MonadSequencer m
  ) =>
  [IngestEvent] -> ConduitT i SeqOutEvent m ()
unseqEventHandler events = do
  let record :: (MonadIO m, MonadLogger m) => T.Text -> T.Text -> Int -> m ()
      record t k num = do
        liftIO $ withLabel eventsplitMetrics t (flip unsafeAddCounter . fromIntegral $ num)
        $logInfoS "splitEvents" . T.pack $ printf "Running %d %s" num k

  let blocks = [b | IEBlock b <- events]

  when (not $ null blocks) $ record "inevent_type_block" "IngestBlocks" (length blocks)
  transformBlocks blocks

  let transactions = [(ts, tx) | IETx ts tx <- events]

  when (not $ null transactions) $ record "inevent_type_transaction" "IngestTransactions" (length transactions)
  transformFullTransactions transactions

  forM_ events $ \event ->
    case event of
        (IETx _ _) -> return () --Already handled above
        (IEBlock _) -> return () --Already handled above
        (IEBlockstanbul (WireMessage a m))-> do
          record "inevent_type_blockstanbul" "IngestBlockstanbuls" 1
          blockstanbulSend [IMsg a m]
        (IEValidatorBehavior vc) -> do
          record "inevent_type_validator_behavior" "ValidatorBehaviorChange" 1
          blockstanbulSend [ValidatorBehaviorChange vc]
        (IEForcedConfigChange cc) -> do
          record "inevent_type_forced_config_change" "ForcedConfigChanges" 1
          blockstanbulSend [ForcedConfigChange cc]
        (IEDeleteDepBlock k) -> do
          record "inevent_type_delete_dep_block" "DeleteDepBlock" 1
          lift $ A.delete (A.Proxy @DependentBlockEntry) k
        (IEGetMPNodes srs) -> do
          record "inevent_type_get_mp_nodes" "GetMPNodes" 1
          yield $ Left [P2pGetMPNodes srs]
          return ()
        (IEGetMPNodesRequest o srs) -> do
          record "inevent_type_get_mp_nodes_request" "GetMPNodesRequest" 1
          yield $ Right [VmGetMPNodesRequest o srs]
          return ()
        (IEMPNodesResponse o nds)-> do
          record "inevent_type_mp_nodes_response" "MPNodesResponse" 1
          yield $ Left [P2pMPNodesResponse o nds]
          return ()
        (IEMPNodesReceived nds) -> do
          record "inevent_type_mp_nodes_received" "MPNodesReceived" 1
          yield $ Right [VmMPNodesReceived nds]
          return ()
        (IEPreprepareResponse decis) -> do
          record "inevent_type_preprepare_response" "PreprepareResponse" 1
          blockstanbulSend [PreprepareResponse decis]
        (IEFlushMempool req) -> do
          record "inevent_type_flush_mempool" "FlushMempool" 1
          yield $ Right [VmFlushMempool req]
          return ()

bootstrapBlockstanbul :: (MonadBlockstanbul m, Mod.Accessible View m) =>
                         ConduitT i SeqOutEvent m ()
bootstrapBlockstanbul = do
  yield $ Right [VmCreateBlockCommand]
  lift createFirstTimer

blockstanbulSend ::
  ( MonadLogger m,
    MonadBlockstanbul m,
    (Keccak256 `A.Alters` DependentBlockEntry) m
  ) =>
  [InEvent] -> ConduitT i SeqOutEvent m ()
blockstanbulSend = mapM_ $ \ie -> do
      blockstanbulSend' ie

blockstanbulSend' ::
  ( MonadLogger m,
    MonadBlockstanbul m,
    (Keccak256 `A.Alters` DependentBlockEntry) m
  ) =>
  InEvent -> ConduitT i SeqOutEvent m ()
blockstanbulSend' msg = do
  (p2pevs, vmevs) <- lift $ do
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
    let (vms, p2ps) = vmEvenP2pCheckptFilterHelper resp

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
        ctx <- fmap (fromMaybe $ error "BlockstanbulContext missing") $ getBlockstanbulContext
        Mod.put (Mod.Proxy @BestSequencedBlock) $
          BestSequencedBlock
              (BDB.blockHeaderHash bh)
              (BDB.blockHeaderBlockNumber bh)
              (S.toList $ _validators ctx)
    pure (p2pevs, vmevs)

  $logDebugS "seq/pbft/send_p2p" . T.pack $ format p2pevs
  yield $ Left p2pevs
  $logDebugS "seq/pbft/send_vm" . T.pack $ format vmevs
  yield $ Right vmevs
  where
    vmEvenP2pCheckptFilterHelper :: [OutEvent] -> ([VmEvent], [P2pEvent])
    vmEvenP2pCheckptFilterHelper (x : xs) = do
      let (vms, p2ps) = vmEvenP2pCheckptFilterHelper xs
      case x of
        OMsg a m -> (vms, P2pBlockstanbul (WireMessage a m) : p2ps)
        GapFound h l p -> (vms, (P2pAskForBlocks (h + 1) l p) : p2ps)
        LeadFound h l p -> (vms, (P2pPushBlocks (l + 1) h p) : p2ps)
        RunPreprepare b -> (VmRunPreprepare b : vms, p2ps)
        _ -> (vms, p2ps)
    vmEvenP2pCheckptFilterHelper [] = ([], [])

transformFullTransactions ::
  ( MonadLogger m,
    MonadMonitor m,
    (Keccak256 `A.Alters` ()) m
  ) =>
  [(Timestamp, IngestTx)] -> ConduitT i SeqOutEvent m ()
transformFullTransactions pairs = do
  let logF = logFF "transformEvents/emitTxs"
  mOtxs <- lift . forM pairs $ \(ts, itx) ->
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
  lift . logF $ "Sending " ++ show (length txs) ++ " public transactions to P2P and the VM"
  yield . Right $ map pairToVmTx txs
  yield . Left $ map (P2pTx . snd) txs
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
    (Keccak256 `A.Alters` DependentBlockEntry) m
  ) =>
  SequencedBlock -> ConduitT i SeqOutEvent m ()
runConsensus sb = do
  hasPBFT <- lift blockstanbulRunning
  if not hasPBFT
    then do
      obs <- lift $ expandBlock sb
      for_ obs $ \ob -> yield $ Left [P2pBlock ob]
      yield . Right $ map VmBlock obs
    else do
      let blk = sequencedBlockToBlock sb
      routed <-
        if isHistoricBlock blk
          then lift $ map (PreviousBlock . outputBlockToBlock) <$> expandBlock sb
          else pure [UnannouncedBlock blk]
      -- Blockstanbul will check that the seals and validators match up before
      -- announcing it to the network or forwarding to the EVM.
      traverse_ blockstanbulSend' routed

transformBlocks ::
  ( MonadLogger m,
    MonadMonitor m,
    MonadBlockstanbul m,
    (Keccak256 `A.Alters` DependentBlockEntry) m
  ) =>
  [IngestBlock] -> ConduitT i SeqOutEvent m ()
transformBlocks ibs = do
  forM_ ibs $ \ib ->
    case (ingestBlockToSequencedBlock ib) of
      Nothing -> do
        $logWarnS "transformEvents/emitBlocks" . T.pack $
          "Could not ECRecover the pubkey of certain Txs in Block " ++ prettyIBlock ib ++ "; not emitting"
        lift $ P.incCounter seqBlocksEcrfail -- couldnt ecrecover some transactions in this block. block is likely garbage
      Just sb -> do
        runConsensus sb

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

    shortOrigin (TO.PeerString peer) = "Peer " ++ take 8 peer
    shortOrigin x = format x
