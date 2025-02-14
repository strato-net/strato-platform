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
  runConduit $ source .| eventHandler

eventHandler :: (
  MonadFail m,
  HasKafka m,
  MonadSequencer m,
  (() `A.Alters` Checkpoint) m
  ) =>
  ConduitT SeqLoopEvent Void m ()
eventHandler = forever $ timeAction seqLoopTiming $ do
  logFF "sequencer/events" "Reading from fused channels..."
  maybeEvent <- await
  let event = fromMaybe (error "input stream to sequencer closed, this shouldn't happen") maybeEvent

  $logInfoS "sequencer/events" . T.pack $ format event

  case event of
    TimerFire roundNumber -> do
      withLabel seqLoopEvents "timeout" (flip unsafeAddCounter 1)
      blockstanbulSend [Timeout roundNumber]
    UnseqEvents unseqEvents -> do
      withLabel seqLoopEvents "unseq" (flip unsafeAddCounter . fromIntegral . length $ unseqEvents)
      timeAction seqSplitEventsTiming $ unseqEventHandler unseqEvents

unseqEventHandler ::
  ( MonadSequencer m, 
    (() `A.Alters` Checkpoint) m,
    HasKafka m) =>
  [IngestEvent] -> m ()
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
          A.delete (A.Proxy @DependentBlockEntry) k
        (IEGetMPNodes srs) -> do
          record "inevent_type_get_mp_nodes" "GetMPNodes" 1
          _ <- writeSeqP2pEvents [P2pGetMPNodes srs]
          return ()
        (IEGetMPNodesRequest o srs) -> do
          record "inevent_type_get_mp_nodes_request" "GetMPNodesRequest" 1
          _ <- writeSeqVmEvents [VmGetMPNodesRequest o srs]
          return ()
        (IEMPNodesResponse o nds)-> do
          record "inevent_type_mp_nodes_response" "MPNodesResponse" 1
          _ <- writeSeqP2pEvents [P2pMPNodesResponse o nds]
          return ()
        (IEMPNodesReceived nds) -> do
          record "inevent_type_mp_nodes_received" "MPNodesReceived" 1
          _ <- writeSeqVmEvents [VmMPNodesReceived nds]
          return ()
        (IEPreprepareResponse decis) -> do
          record "inevent_type_preprepare_response" "PreprepareResponse" 1
          blockstanbulSend [PreprepareResponse decis]

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
  $logInfoS "seq/pbft/send" . T.pack $ "Sending message: " ++ show msg
  resp <- sendAllMessages [msg]
  $logInfoS "seq/pbft/send" . T.pack $ "Received response: " ++ show resp

  let blocks = [b | ToCommit b <- resp]
  $logInfoS "seq/pbft/send" . T.pack $ "Blocks to commit: " ++ show (map blockHash blocks)

  for_ resp $ \case
    ResetTimer rn -> do
      $logInfoS "seq/pbft/send" . T.pack $ "Resetting timer for round: " ++ show rn
      createNewTimer rn
    FailedHistoric blk -> do
      $logInfoS "seq/pbft/send" . T.pack $ "Failed historic block: " ++ show (blockHash blk)
      A.delete (Proxy @DependentBlockEntry) (blockHash blk)
    _ -> pure ()

  $logInfoS "seq/pbft/send" . T.pack $ "Pre-rewrite: " ++ format (blockHash <$> blocks)

  let getSequencedBlock =
        ingestBlockToSequencedBlock
          . blockToIngestBlock TO.Blockstanbul
      creates = [VmCreateBlockCommand | MakeBlockCommand <- resp]
  let rBlocks = catMaybes (map getSequencedBlock blocks)
  $logInfoS "seq/pbft/send" . T.pack $ "Sequenced blocks: " ++ show (map prettyBlock rBlocks)

  committedBlocks <- catMaybes <$> traverse insertEmitted rBlocks
  $logInfoS "seq/pbft/send" . T.pack $ "Committed blocks: " ++ show (committedBlocks)

  let (vms, p2ps, ckpts) = vmEvenP2pCheckptFilterHelper resp

  let vmevs =
        creates
          ++ (VmBlock <$> committedBlocks)
          ++ vms
  let p2pevs =
        (P2pBlock <$> committedBlocks)
          ++ p2ps

  $logInfoS "seq/pbft/send" . T.pack $ "VM events: " ++ show vmevs
  $logInfoS "seq/pbft/send" . T.pack $ "P2P events: " ++ show p2pevs

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
  $logInfoS "runConsensus" . T.pack $ "Starting consensus for block: " ++ prettyBlock sb
  hasPBFT <- blockstanbulRunning
  if not hasPBFT
    then do
      $logInfoS "runConsensus" "PBFT is not running, expanding block."
      obs <- expandBlock sb
      flip traverse_ obs $ \ob -> do
        $logInfoS "runConsensus" . T.pack $ "Emitting P2P block: " ++ show ob
        _ <- writeSeqP2pEvents [P2pBlock ob]
        return ()
      $logInfoS "runConsensus" "Emitting VM blocks."
      _ <- writeSeqVmEvents $ map VmBlock obs
      return ()
    else do
      $logInfoS "runConsensus" "PBFT is running, processing block."
      let blk = sequencedBlockToBlock sb
      routed <-
        if isHistoricBlock blk
          then do
            $logInfoS "runConsensus" "Block is historic, expanding block."
            map (PreviousBlock . outputBlockToBlock) <$> expandBlock sb
          else do
            $logInfoS "runConsensus" "Block is unannounced."
            pure [UnannouncedBlock blk]
      $logInfoS "runConsensus" "Sending blocks to Blockstanbul."
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
transformBlocks ibs = do
  $logInfoS "transformBlocks" . T.pack $ "Starting to transform " ++ show (length ibs) ++ " blocks."
  forM_ ibs $ \ib -> do
    $logInfoS "transformBlocks" . T.pack $ "Processing block: " ++ prettyIBlock ib
    case (ingestBlockToSequencedBlock ib) of
      Nothing -> do
        $logWarnS "transformEvents/emitBlocks" . T.pack $
          "Could not ECRecover the pubkey of certain Txs in Block " ++ prettyIBlock ib ++ "; not emitting"
        P.incCounter seqBlocksEcrfail -- couldnt ecrecover some transactions in this block. block is likely garbage
      Just sb -> do
        $logInfoS "transformBlocks" . T.pack $ "Successfully transformed block: " ++ prettyBlock sb
        runConsensus sb
  $logInfoS "transformBlocks" "Finished transforming blocks."

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
