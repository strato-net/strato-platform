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

module Blockchain.Sequencer where

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Blockstanbul 
import qualified Blockchain.Data.Block as BDB
import Blockchain.Data.BlockHeader
import Blockchain.Data.ChainInfo (chainInfo, creationBlock, parentChains)
import qualified Blockchain.Data.RLP as RL
import qualified Blockchain.Data.TXOrigin as TO
import qualified Blockchain.Data.TransactionDef as TD
import Blockchain.Partitioner
import Blockchain.Privacy
import Blockchain.Sequencer.CablePackage
import Blockchain.Sequencer.DB.DependentBlockDB
import Blockchain.Sequencer.DB.GetChainsDB
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
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import ClassyPrelude (atomically)
import Conduit
import Control.Concurrent hiding (yield)
import Control.Concurrent.STM.TBQueue
import Control.Concurrent.STM.TQueue
import Control.Lens
import Control.Monad (forM, join, unless, when)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Reader
import Data.Foldable
import qualified Data.Map.Strict as M
import Data.Maybe
import Data.Proxy
import qualified Data.Set as S
import qualified Data.Text as T
--import Data.Tuple.Extra ((&&&))
import Data.Time.Clock
import Prometheus as P
import qualified Text.Colors as CL
import Text.Format
import Text.Printf
--import Blockchain.Data.Block (Block(blockBlockData))

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

instance (Monad m, HasPrivateHashDB m) => HasPrivateHashDB (ConduitT i o m) where
  requestChain = lift . requestChain
  requestTransaction = lift . requestTransaction

data SeqEvent
  = ToVm VmEvent
  | ToP2p P2pEvent
  | ToUnseq Checkpoint

data BatchSeqEvent = BatchSeqEvent
  { _toVm :: [VmEvent],
    _toP2p :: [P2pEvent],
    _toUnseq :: [Checkpoint]
  }

makeLenses ''BatchSeqEvent

emptyBatchSeqEvent :: BatchSeqEvent
emptyBatchSeqEvent = BatchSeqEvent [] [] []

batchSeqEvents :: [SeqEvent] -> BatchSeqEvent
batchSeqEvents = foldr f emptyBatchSeqEvent
  where
    f e b = case e of
      ToVm v -> (toVm %~ (v :)) b
      ToP2p p -> (toP2p %~ (p :)) b
      ToUnseq u -> (toUnseq %~ (u :)) b

runBatch :: Monad m => ConduitT () SeqEvent m () -> m BatchSeqEvent
runBatch c = fmap batchSeqEvents . runConduit $ c .| sinkList

logFF :: MonadLogger m => T.Text -> String -> m ()
logFF str = $logInfoS str . T.pack

-- replace with this when debugging tests
--logFF str msg = void . return $! traceShowId $! trace (T.unpack str) msg

type MonadSequencer m =
  ( MonadLogger m,
    MonadMonitor m,
    MonadBlockstanbul m,
    HasFullPrivacy m,
    (Keccak256 `A.Alters` DependentBlockEntry) m,
    (Keccak256 `A.Alters` ()) m,
    HasVault m
  )

sequencer :: [Validator] -> SequencerM ()
sequencer validators = do
  let logF = logFF "sequencer"
  hasPBFT <- isJust <$> getBlockstanbulContext
  when (hasPBFT) $ do
    ctx <- fromJust <$> getBlockstanbulContext
    maybeCert <- A.lookup (A.Proxy @X509CertInfoState) (fromJust $ _selfAddr ctx)
    case maybeCert of
      Just cert -> do
        let chainm = getChainMemberFromX509 cert
        logF $ "Node identity verified: " ++ show chainm
        case chainMemberParsedSetToValidator chainm `elem` validators of
          True -> do
            putBlockstanbulContext $ ctx { _selfCert = Just chainm, _isValidator = True }
            logF "You are a validator in this network!"
          False -> do
            putBlockstanbulContext $ ctx { _selfCert = Just chainm }
      Nothing -> logF "Awaiting node identity verification..."
  logF "Sequencer startup"
  source <- sealConduitT <$> fuseChannels
  bootstrapBlockstanbul
  logF "Sequencer initialized"
  flush
  go source
  where
    go :: SealedConduitT () SeqLoopEvent SequencerM () -> SequencerM ()
    go src = oneSequencerIter src >>= go

oneSequencerIter :: SealedConduitT () SeqLoopEvent SequencerM () -> SequencerM (SealedConduitT () SeqLoopEvent SequencerM ())
oneSequencerIter src = timeAction seqLoopTiming $ do
  (src', events) <- readEventsInBufferedWindow src
  BatchSeqEvent {..} <- runSequencerBatch events
  chainIds <- unGetChainsDB <$> Mod.get (Mod.Proxy @GetChainsDB)
  txHashes <- unGetTransactionsDB <$> Mod.get (Mod.Proxy @GetTransactionsDB)
  let chainIdsList = toList chainIds
      txHashesList = toList txHashes
      getChains = if null chainIdsList then [] else [P2pGetChain chainIdsList]
      getTxs = if null txHashesList then [] else [P2pGetTx txHashesList]
      toP2p' = getChains ++ getTxs ++ _toP2p
  flushLdbBatchOps
  prunePrivacyDBs

  unless (null _toVm) $ do
    _ <- writeSeqVmEvents _toVm
    $logDebugS "sequencer" . T.pack $ "Wrote " ++ format _toVm ++ " SeqEvents to VM"
  unless (null toP2p') $ do
    _ <- writeSeqP2pEvents toP2p'
    $logDebugS "sequencer" . T.pack $ "Wrote " ++ format toP2p' ++ " SeqEvents to P2P"
  unless (null _toUnseq) $ writeUnseqCheckpoints _toUnseq
  flush
  return src'

flush :: SequencerM ()
flush =
  clearDBERegistry
    >> clearGetChainsDB
    >> clearGetTransactionsDB

readEventsInBufferedWindow :: SealedConduitT () SeqLoopEvent SequencerM () -> SequencerM (SealedConduitT () SeqLoopEvent SequencerM (), [SeqLoopEvent])
readEventsInBufferedWindow src = do
  let logF = logFF "sequencer/events"
  logF "Reading from fused channels..."
  dt <- asks maxUsPerIter
  uch <- asks $ unseqEvents . cablePackage
  top <- atomically . tryPeekTBQueue $ uch
  $logDebugS "sequencer/events" . T.pack $ "top event is: " ++ show top
  -- There may be WaitTerminateds left over from the last iteration
  -- This will block indefinitely if there are no real messages to process,
  -- so `src` must be the only source of input to this thread.
  (src', ()) <- src $$++ dropWhileC (== WaitTerminated)
  -- Only append the WaitTerminateds once we are certain that we will not drop them
  -- again
  createWaitTimer dt
  maxEvents <- asks maxEventsPerIter
  -- Takes up to maxEvents for a single buffer, waiting only as long as maxUsPerIter
  (src'', events) <-
    src' $$++ takeWhileC (/= WaitTerminated)
      .| takeC maxEvents
      .| sinkList
  $logDebugS "sequencer/events" . T.pack $ format events
  logF . printf "read %d events from fused channels" $ length events
  return (src'', events)

runSequencerBatch ::
  MonadSequencer m =>
  [SeqLoopEvent] ->
  m BatchSeqEvent
runSequencerBatch events = runBatch $ do
  let BatchSeqLoopEvent {..} = batchSeqLoopEvents events
  checkForTimeouts _timerFires
  checkForUnseq _ingestEvents

checkForTimeouts ::
  ( MonadLogger m,
    MonadMonitor m,
    MonadBlockstanbul m,
    HasFullPrivacy m,
    (Keccak256 `A.Alters` DependentBlockEntry) m
  ) =>
  [RoundNumber] ->
  ConduitT a SeqEvent m ()
checkForTimeouts rns = do
  withLabel seqLoopEvents "timeout" (flip unsafeAddCounter . fromIntegral . length $ rns)
  blockstanbulSend . map Timeout $ rns

checkForUnseq ::
  MonadSequencer m =>
  [IngestEvent] ->
  ConduitT a SeqEvent m ()
checkForUnseq inEvents = do
  withLabel seqLoopEvents "unseq" (flip unsafeAddCounter . fromIntegral . length $ inEvents)
  timeAction seqSplitEventsTiming $ splitEvents inEvents

bootstrapBlockstanbul :: SequencerM ()
bootstrapBlockstanbul = do
  _ <- writeSeqVmEvents [VmCreateBlockCommand]
  createFirstTimer

blockstanbulSend ::
  ( MonadLogger m,
    MonadMonitor m,
    MonadBlockstanbul m,
    HasFullPrivacy m,
    (Keccak256 `A.Alters` DependentBlockEntry) m
  ) =>
  [InEvent] ->
  ConduitT a SeqEvent m ()
blockstanbulSend = mapM_ $ \ie -> do
  ses <-
    runConduit $
      blockstanbulSend' ie
        .| hydrateAndEmit
        .| sinkList
  yieldMany ses

blockstanbulSend' ::
  ( MonadLogger m,
    MonadBlockstanbul m,
    (Keccak256 `A.Alters` DependentBlockEntry) m
  ) =>
  InEvent ->
  ConduitT a SeqEvent m ()
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
        BDB.BestBlock (BDB.blockHeaderHash bh) (BDB.blockHeaderBlockNumber bh) (obTotalDifficulty b)

  $logDebugS "seq/pbft/send_checkpoints" . T.pack $ show ckpts
  yieldMany $ ToUnseq <$> ckpts
  $logDebugS "seq/pbft/send_p2p" . T.pack $ format p2pevs
  yieldMany $ ToP2p <$> p2pevs
  $logDebugS "seq/pbft/send_vm" . T.pack $ format vmevs
  yieldMany $ ToVm <$> vmevs
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

privateWitnessableHash :: Keccak256 -> Keccak256 -> Keccak256
privateWitnessableHash tHash cHash =
  hash
    . RL.rlpSerialize
    $ RL.RLPArray [RL.rlpEncode tHash, RL.rlpEncode cHash]

transformPrivateHashTXs ::
  ( MonadLogger m,
    HasPrivateHashDB m,
    (Keccak256 `A.Alters` ChainHashEntry) m,
    (Keccak256 `A.Alters` ()) m
  ) =>
  [(Timestamp, IngestTx)] ->
  ConduitT a SeqEvent m ()
transformPrivateHashTXs pairs = forM_ pairs $ \(ts, t@(IngestTx _ (TD.PrivateHashTX th' ch'))) -> do
  motx <- wrapTransaction t
  for_ motx $ \otx -> do
    let privateWitnessHash = privateWitnessableHash th' ch'
    pwitnessed <- wasTransactionHashWitnessed privateWitnessHash
    unless pwitnessed $ do
      witnessTransactionHash privateWitnessHash
      runPrivateHashTX th' ch'
      yield . ToP2p $ P2pTx otx
      yield . ToVm $ VmTx ts otx

transformFullTransactions ::
  ( MonadLogger m,
    MonadMonitor m,
    HasFullPrivacy m,
    (Keccak256 `A.Alters` ()) m
  ) =>
  [(Timestamp, IngestTx)] ->
  ConduitT a SeqEvent m ()
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
  let otxs = catMaybes mOtxs
  forM_ (partitionWith (isPrivateChainTX . otBaseTx . snd) otxs) $ \(isPrivateChain, txs) ->
    if not isPrivateChain
      then do
        logF $ "Sending " ++ show (length txs) ++ " public transactions to P2P and the VM"
        yieldMany $ (ToVm . pairToVmTx) <$> txs
        yieldMany $ (ToP2p . P2pTx . snd) <$> txs
      else forM_ (partitionWith (TD.transactionChainId . otBaseTx . snd) txs) $ \(Just chainId, ptxs) -> do
        logF . concat $
          [ "Transforming ",
            show (length txs),
            " private transactions on chain ",
            CL.yellow $ format chainId
          ]
        mapM_ (insertTransaction . snd) ptxs
        yieldMany $ (ToVm . VmPrivateTx . snd) <$> ptxs -- we want to get these transactions into the
        -- P2P indexer ASAP so we can return them to
        -- peers requesting them
        mcInfo <- join . fmap _chainIdInfo <$> A.lookup (Proxy :: Proxy ChainIdEntry) chainId
        case mcInfo of
          Nothing -> do
            logF . concat $
              [ "We haven't seen the details for chain ",
                CL.yellow $ format chainId,
                ". Inserting the chain Id into the GetChains list"
              ]
            requestChain chainId
          Just cInfo -> do
            forM_ ptxs $ \(ts, ptx) -> do
              logF . concat $
                [ "We know the details for chain ",
                  CL.yellow $ format chainId,
                  ". Sending to P2P."
                ]
              yield . ToP2p $ P2pTx ptx
              --liftIO $ withLabel txMetrics "private_hash" incCounter
              when (otOrigin ptx == TO.API) $ do
                cHash <-
                  getNewChainHash chainId >>= \case
                    Nothing -> do
                      let iHash = generateInitialChainHash cInfo
                      logF . concat $
                        [ "transformFullTransactions: ",
                          "Encountered empty chain hash buffer for chain ID ",
                          "Could not acquire new chain hash for chain ID ",
                          TD.formatChainId $ Just chainId,
                          ". Using initial chain hash instead: ",
                          format iHash
                        ]
                      return iHash
                    Just ch -> return ch
                let tHash = txHash ptx
                    th' = txHash ptx
                    ch' = cHash
                    phtx = ptx {otBaseTx = TD.PrivateHashTX th' ch'}
                    privateWitnessHash = privateWitnessableHash th' ch'
                witnessTransactionHash privateWitnessHash
                logF . concat $
                  [ "Created chain hash ",
                    format cHash,
                    " for transaction ",
                    format tHash
                  ]
                yield . ToVm $ pairToVmTx (ts, phtx)
                yield . ToP2p $ P2pTx phtx
            yieldMany . map (ToVm . VmBlock) =<< runBlocks chainId

transformTransactions ::
  ( MonadLogger m,
    MonadMonitor m,
    HasFullPrivacy m,
    (Keccak256 `A.Alters` ()) m
  ) =>
  [(Timestamp, IngestTx)] ->
  ConduitT a SeqEvent m ()
transformTransactions events = forM_ (partitionWith (isPrivateHashTX . itTransaction . snd) events) $ \(isPrivateHash, pairs) ->
  if isPrivateHash
    then transformPrivateHashTXs pairs
    else transformFullTransactions pairs

runBlockWithConsensus ::
  ( MonadLogger m,
    MonadMonitor m,
    MonadBlockstanbul m,
    HasFullPrivacy m,
    (Keccak256 `A.Alters` DependentBlockEntry) m
  ) =>
  SequencedBlock ->
  ConduitT a SeqEvent m ()
runBlockWithConsensus sb = do
  ses <-
    runConduit
      ( yield sb
          .| runConsensus
          .| hydrateAndEmit
          .| sinkList
      )
  yieldMany ses

expandBlock ::
  ( MonadLogger m,
    MonadMonitor m,
    (Keccak256 `A.Alters` DependentBlockEntry) m
  ) =>
  SequencedBlock ->
  m [OutputBlock]
expandBlock sb = do
  readiness <- enqueueIfParentNotEmitted sb
  case readiness of
    NotReadyToEmit -> do
      $logWarnS "expandBlock" . T.pack $ prettyBlock sb ++ " is not yet ready to emit."
      P.incCounter seqBlocksEnqueued
      return []
    (ReadyToEmit totalPastDifficulty) -> do
      -- TODO: buildEmissionChain needs to do all of this so that we don't emit blocks missing transactions prematurely
      dryChain <- buildEmissionChain sb totalPastDifficulty
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
  ConduitT SequencedBlock SeqEvent m ()
runConsensus = awaitForever $ \sb -> do
  hasPBFT <- lift blockstanbulRunning
  if not hasPBFT
    then do
      obs <- lift $ expandBlock sb
      traverse_ (yield . ToP2p . P2pBlock) obs
      yieldMany $ ToVm . VmBlock <$> obs
    else do
      let blk = sequencedBlockToBlock sb
      routed <-
        if isHistoricBlock blk
          then lift $ map (PreviousBlock . outputBlockToBlock) <$> expandBlock sb
          else pure [UnannouncedBlock blk]
      -- Blockstanbul will check that the seals and validators match up before
      -- announcing it to the network or forwarding to the EVM.
      traverse_ blockstanbulSend' routed

hydrateAndEmit ::
  ( MonadLogger m,
    MonadMonitor m,
    HasFullPrivacy m
  ) =>
  ConduitT SeqEvent SeqEvent m ()
hydrateAndEmit = awaitForever $ \case
  ToVm (VmBlock ob) -> do
    let logF = logFF "hydrateAndEmit"
    let obHash = blockHash ob
        orig = obOrigin ob
    logF $ "Emitting block " ++ format obHash
    chainsToEmit <- fmap _blockDependentChains . A.repsert (A.Proxy @EmittedBlock) obHash $ \case
      Nothing -> pure $ EmittedBlock True M.empty
      Just (EmittedBlock _ chains) -> pure $ EmittedBlock True chains
    logF $ "Emitting block " ++ format obHash ++ ". Chains to emit: " ++ show (format <$> M.keys chainsToEmit)
    ob' <- lift $ hydratePrivateHashes Nothing ob
    case ob' of
      Nothing ->
        $logErrorS "hydrateAndEmit" . T.pack $
          "hydratePrivateHashes didn't return a block for the main chain. This probably means there is a bug in the platform"
      Just ob'' -> yield . ToVm $ VmBlock ob''
    -- use ob's origin because we don't hold on to chain's original origin
    transformGenesis . map (\(cId, info) -> IngestGenesis orig (cId, info)) $ M.toList chainsToEmit
    lift . A.adjustStatefully_ (A.Proxy @EmittedBlock) obHash $ blockDependentChains .= M.empty
  oe -> yield oe

transformBlocks ::
  ( MonadLogger m,
    MonadMonitor m,
    MonadBlockstanbul m,
    HasFullPrivacy m,
    (Keccak256 `A.Alters` DependentBlockEntry) m
  ) =>
  [IngestBlock] ->
  ConduitT a SeqEvent m ()
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
        runBlockWithConsensus sb

transformGenesis ::
  ( MonadLogger m,
    MonadMonitor m,
    HasFullPrivacy m
  ) =>
  [IngestGenesis] ->
  ConduitT a SeqEvent m ()
transformGenesis chains = forM_ chains $ \ig -> do
  let logF = logFF "transformGenesis"
  let og = ingestGenesisToOutputGenesis ig
      (chainId, cInfo) = ogGenesisInfo og
  logF $ "Transforming ChainInfo for chain " ++ CL.yellow (format chainId) ++ " with info " ++ show cInfo
  lookupSeenChain chainId >>= \case
    True -> do
      logF "We've seen this chain before. Not emitting to VM"
      chainsToEmit <- maybe [] (M.toList . _chainDependentChains) <$> A.lookup (A.Proxy @ChainIdEntry) chainId
      transformGenesis $ map (\ci -> ig {igGenesisInfo = ci}) chainsToEmit
      lift . A.adjustStatefully_ (A.Proxy @ChainIdEntry) chainId $ chainDependentChains .= M.empty
    False -> do
      logF "We haven't seen this chain before. Inserting into SeenChainDB and emitting to VM, P2P"
      logF $ "Checking emission status of block " ++ format (creationBlock $ chainInfo cInfo)
      seenCreationBlock <- fmap _emitted . lift . A.repsert (A.Proxy @EmittedBlock) (creationBlock $ chainInfo cInfo) $ \case
        Nothing -> pure $ EmittedBlock False (M.singleton chainId cInfo)
        Just (EmittedBlock emitted' depChains)
          | emitted' -> pure $ EmittedBlock emitted' M.empty
          | otherwise -> pure $ EmittedBlock emitted' (M.insert chainId cInfo depChains)
      logF $ "Emission status of block " ++ format (creationBlock $ chainInfo cInfo) ++ ": " ++ show seenCreationBlock
      let parentChainIds = M.elems . parentChains $ chainInfo cInfo
      seenParentChains <- and <$> traverse (hasAllAncestorChains . Just) parentChainIds
      logF $ "hasAllAncestorChains: " ++ show seenParentChains
      if seenParentChains
        then when seenCreationBlock $ do
          yield . ToVm $ VmGenesis og
          yield . ToP2p $ P2pGenesis og
          yieldMany . map (ToVm . VmBlock) =<< insertNewChainInfo chainId cInfo
          chainsToEmit <- maybe [] (M.toList . _chainDependentChains) <$> A.lookup (A.Proxy @ChainIdEntry) chainId
          transformGenesis $ map (\ci -> ig {igGenesisInfo = ci}) chainsToEmit
          lift . A.adjustStatefully_ (A.Proxy @ChainIdEntry) chainId $ chainDependentChains .= M.empty
        else case parentChainIds of
          [] ->
            $logErrorS "transformGenesis" . T.pack $
              concat
                [ "The database claims to be missing parent chain info for chain ",
                  format chainId,
                  ", but its parent chain is the main chain. This probably means there is a bug in the platform."
                ]
          pChains -> for_ pChains $ \pChain -> A.repsert_ (A.Proxy @ChainIdEntry) pChain $ \case
            Nothing -> pure $ ChainIdEntry Nothing emptyCircularBuffer S.empty $ M.singleton chainId cInfo
            Just cie@ChainIdEntry {} -> pure $ cie & chainDependentChains %~ M.insert chainId cInfo

splitEvents ::
  ( MonadLogger m,
    MonadMonitor m,
    MonadBlockstanbul m,
    HasFullPrivacy m,
    (Keccak256 `A.Alters` DependentBlockEntry) m,
    (Keccak256 `A.Alters` ()) m
  ) =>
  [IngestEvent] ->
  ConduitT a SeqEvent m () -- splitWith iEventType es) --> (IET, [IE]) ()IET, IE)
splitEvents es = forM_ (splitWith iEventType es) $ \(eventType, events) ->
  let num = length events
      record :: (MonadIO m, MonadLogger m) => T.Text -> T.Text -> m ()
      record t k = do
        liftIO $ withLabel eventsplitMetrics t (flip unsafeAddCounter . fromIntegral $ num)
        $logInfoS "splitEvents" . T.pack $ printf "Running %d %s" num k
   in case eventType of
        IETTransaction -> do
          record "inevent_type_transaction" "IngestTransactions"
          transformTransactions $ map (\(IETx ts tx) -> (ts, tx)) events
        IETBlock -> do
          record "inevent_type_block" "IngestBlocks"
          transformBlocks $ map (\(IEBlock ob) -> ob) events
        IETGenesis -> do
          record "inevent_type_genesis" "IngestGenesises"
          transformGenesis $ map (\(IEGenesis og) -> og) events
        IETNewChainOrgName -> do
          record "inevent_type_new_org_name" "IngestNewChainOrgName"
          yieldMany $ map (\(IENewChainOrgName c cm) -> ToP2p $ P2pNewOrgName c cm) events
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
          yieldMany $ map (\(IEGetMPNodes srs) -> ToP2p $ P2pGetMPNodes srs) events
        IETGetMPNodesRequest -> do
          record "inevent_type_get_mp_nodes_request" "GetMPNodesRequest"
          yieldMany $ map (\(IEGetMPNodesRequest o srs) -> ToVm $ VmGetMPNodesRequest o srs) events
        IETMPNodesResponse -> do
          record "inevent_type_mp_nodes_response" "MPNodesResponse"
          yieldMany $ map (\(IEMPNodesResponse o nds) -> ToP2p $ P2pMPNodesResponse o nds) events
        IETMPNodesReceived -> do
          record "inevent_type_mp_nodes_received" "MPNodesReceived"
          yieldMany $ map (\(IEMPNodesReceived nds) -> ToVm $ VmMPNodesReceived nds) events
        IETPreprepareResponse -> do
          record "inevent_type_preprepare_response" "PreprepareResponse"
          blockstanbulSend $ map (\(IEPreprepareResponse decis) -> PreprepareResponse decis) events

prettyIBlock :: IngestBlock -> String
prettyIBlock IngestBlock {ibOrigin = o, ibBlockData = bd, ibReceiptTransactions = txs} = "Block #" ++ blockNonce ++ "/" ++ bHash ++ " (via " ++ format o ++ ", " ++ show (length txs) ++ " txs)"
  where
    blockNonce = show . number $ bd
    bHash = format . BDB.blockHeaderHash $ bd

prettyOBlock :: OutputBlock -> String
prettyOBlock OutputBlock {obOrigin = o, obBlockData = bd, obReceiptTransactions = txs} = "Block #" ++ blockNonce ++ "/" ++ bHash ++ " (via " ++ format o ++ ", " ++ show (length txs) ++ " txs)"
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

prettyOTx :: OutputTx -> String
prettyOTx OutputTx {otOrigin = o, otBaseTx = t} = prefix t ++ " via " ++ shortOrigin o
  where
    prefix TD.MessageTX {} = "MessageTx [" ++ (format $ txHash t) ++ "]"
    prefix TD.ContractCreationTX {} = "CreationTx[" ++ (format $ txHash t) ++ "]"
    prefix TD.PrivateHashTX {} = "PrivateHashTx[" ++ (format $ txHash t) ++ "]"

    shortOrigin (TO.PeerString peer) = "Peer " ++ take 8 peer
    shortOrigin x = format x

writeUnseqCheckpoints :: [Checkpoint] -> SequencerM ()
writeUnseqCheckpoints events = do
  ch <- asks (unseqCheckpoints . cablePackage)
  atomically . mapM_ (writeTQueue ch) $ events

splitWith :: Eq k => (a -> k) -> [a] -> [(k, [a])]
splitWith f = foldr agg []
  where
    agg a [] = [(f a, [a])]
    agg a kas@((k, as) : kas') =
      let fa = f a
       in if fa == k
            then (k, a : as) : kas'
            else (fa, [a]) : kas
