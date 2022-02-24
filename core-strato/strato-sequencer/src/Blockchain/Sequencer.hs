{-# LANGUAGE ConstraintKinds   #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TupleSections     #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Sequencer where

import           ClassyPrelude                             (atomically)
import           Conduit
import           Control.Concurrent                        hiding (yield)
import           Control.Concurrent.STM.TQueue
import           Control.Concurrent.STM.TBQueue
import           Blockchain.Output
import           Control.Lens
import qualified Control.Monad.Change.Alter                as A
import qualified Control.Monad.Change.Modify               as Mod
import           Control.Monad.Reader

import           Data.ByteString.Char8                     (pack)
import           Data.ByteString.Base16                    as B16
import           Data.Foldable
import qualified Data.Map.Strict                           as M
import           Data.Maybe
import           Data.Proxy
import qualified Data.Set                                  as S
import qualified Data.Text                                 as T
import           Data.Time.Clock
import           Prometheus                                as P
import           Text.Printf

import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.HTTPAdmin         as API
import           Blockchain.Privacy
import           Blockchain.Sequencer.CablePackage
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.DB.GetChainsDB
import           Blockchain.Sequencer.DB.GetTransactionsDB
import           Blockchain.Sequencer.DB.SeenTransactionDB
import           Blockchain.Sequencer.DB.Witnessable
import           Blockchain.Sequencer.Event

import           Blockchain.Sequencer.Metrics
import           Blockchain.Sequencer.Monad

import qualified Blockchain.Data.Block                     as BDB
import           Blockchain.Data.ChainInfo                 (chainInfo, creationBlock, parentChain)
import qualified Blockchain.Data.DataDefs                  as BDB
import qualified Blockchain.Data.TransactionDef            as TD
import qualified Blockchain.Data.TXOrigin                  as TO
import qualified Blockchain.Data.RLP                       as RL

import           Blockchain.Strato.Model.Class             as BDB
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1

import           Blockchain.Util
import qualified Text.Colors                               as CL
import           Text.Format

instance MonadMonitor m => MonadMonitor (ConduitT i o m) where
  doIO = lift . doIO

instance Mod.Modifiable r m => Mod.Modifiable r (ConduitT i o m) where
  get = lift . Mod.get
  put p = lift . Mod.put p

instance (Monad m, Mod.Accessible r m) => Mod.Accessible r (ConduitT i o m) where
  access = lift . Mod.access

instance HasBlockstanbulContext m => HasBlockstanbulContext (ConduitT i o m) where
  getBlockstanbulContext = lift getBlockstanbulContext
  putBlockstanbulContext = lift . putBlockstanbulContext

instance (Monad m, HasPrivateHashDB m) => HasPrivateHashDB (ConduitT i o m) where
  requestChain = lift . requestChain
  requestTransaction = lift . requestTransaction


data SeqEvent = ToVm VmEvent
              | ToP2p P2pEvent
              | ToUnseq Checkpoint

data BatchSeqEvent = BatchSeqEvent
  { _toVm :: [VmEvent]
  , _toP2p :: [P2pEvent]
  , _toUnseq :: [Checkpoint]
  }
makeLenses ''BatchSeqEvent

emptyBatchSeqEvent :: BatchSeqEvent
emptyBatchSeqEvent = BatchSeqEvent [] [] []

batchSeqEvents :: [SeqEvent] -> BatchSeqEvent
batchSeqEvents = foldr f emptyBatchSeqEvent
  where f e b@BatchSeqEvent{..} = case e of
          ToVm v -> (toVm %~ (v:)) b
          ToP2p p -> (toP2p %~ (p:)) b
          ToUnseq u -> (toUnseq %~ (u:)) b

runBatch :: Monad m => ConduitT () SeqEvent m () -> m BatchSeqEvent
runBatch c = fmap batchSeqEvents . runConduit $ c .| sinkList

logFF :: MonadLogger m => T.Text -> String -> m ()
logFF str = $logInfoS str . T.pack
-- replace with this when debugging tests
--logFF str msg = void . return $! traceShowId $! trace (T.unpack str) msg

type MonadSequencer m =
  ( MonadLogger m
  , MonadMonitor m
  , MonadBlockstanbul m
  , HasFullPrivacy m
  , (Keccak256 `A.Alters` DependentBlockEntry) m
  , (Keccak256 `A.Alters` ()) m
  , (Keccak256 `A.Alters` (Proxy WireMessage)) m
  , HasVault m
  )

sequencer :: SequencerM ()
sequencer = do
  let logF = logFF "sequencer"
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
  BatchSeqEvent{..} <- runSequencerBatch events
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
    writeSeqVmEvents _toVm
    $logDebugS "sequencer" . T.pack $ "Wrote " ++ format _toVm ++ " SeqEvents to VM"
  unless (null toP2p') $ do
    writeSeqP2pEvents toP2p'
    $logDebugS "sequencer" . T.pack $ "Wrote " ++ format toP2p' ++ " SeqEvents to P2P"
  unless (null _toUnseq) $ writeUnseqCheckpoints _toUnseq
  flush
  return src'

flush :: SequencerM ()
flush = clearDBERegistry
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
  (src'', events) <- src' $$++ takeWhileC (/= WaitTerminated)
                          .| takeC maxEvents
                          .| sinkList
  $logDebugS "sequencer/events" . T.pack $ format events
  logF . printf "read %d events from fused channels" $ length events
  return (src'', events)


runSequencerBatch :: MonadSequencer m
                  => [SeqLoopEvent]
                  -> m BatchSeqEvent
runSequencerBatch events = runBatch $ do
  let BatchSeqLoopEvent{..} = batchSeqLoopEvents events
  checkForVotes _votesMade
  checkForTimeouts _timerFires
  checkForUnseq _ingestEvents

checkForVotes :: ( MonadLogger m
                 , MonadMonitor m
                 , MonadBlockstanbul m
                 , HasFullPrivacy m
                 , (Keccak256 `A.Alters` DependentBlockEntry) m
                 , (Keccak256 `A.Alters` (Proxy WireMessage)) m
                 )
              => [CandidateReceived]
              -> ConduitT a SeqEvent m ()
checkForVotes crs = do
  withLabel seqLoopEvents "vote" (flip unsafeAddCounter . fromIntegral . length $ crs)
  blockstanbulSend . map translate $ crs
  where translate :: CandidateReceived -> InEvent
        translate br =
          let extsign = RL.rlpDecode
                      . RL.rlpDeserialize
                      . fst
                      . B16.decode
                      . pack
                      . API.signature $ br
              bauth = MsgAuth { sender = API.sender br, signature = extsign}
          in NewBeneficiary bauth (API.recipient br, API.votingdir br, API.nonce br)

checkForTimeouts :: ( MonadLogger m
                    , MonadMonitor m
                    , MonadBlockstanbul m
                    , HasFullPrivacy m
                    , (Keccak256 `A.Alters` DependentBlockEntry) m
                    , (Keccak256 `A.Alters` (Proxy WireMessage)) m
                    )
                 => [RoundNumber]
                 -> ConduitT a SeqEvent m ()
checkForTimeouts rns = do
  withLabel seqLoopEvents "timeout" (flip unsafeAddCounter . fromIntegral . length $ rns)
  blockstanbulSend . map Timeout $ rns


checkForUnseq :: MonadSequencer m
              => [IngestEvent]
              -> ConduitT a SeqEvent m ()
checkForUnseq inEvents = do
  withLabel seqLoopEvents "unseq" (flip unsafeAddCounter . fromIntegral . length $ inEvents)
  timeAction seqSplitEventsTiming $ splitEvents inEvents

bootstrapBlockstanbul :: SequencerM ()
bootstrapBlockstanbul = do
  writeSeqVmEvents [VmCreateBlockCommand]
  createFirstTimer

blockstanbulSend :: ( MonadLogger m
                    , MonadMonitor m
                    , MonadBlockstanbul m
                    , HasFullPrivacy m
                    , (Keccak256 `A.Alters` DependentBlockEntry) m
                    , (Keccak256 `A.Alters` (Proxy WireMessage)) m
                    )
                 => [InEvent]
                 -> ConduitT a SeqEvent m ()
blockstanbulSend = mapM_ $ \ie -> do
  ses <- runConduit $ blockstanbulSend' ie
                   .| hydrateAndEmit
                   .| sinkList
  yieldMany ses

blockstanbulSend' :: ( MonadLogger m
                     , MonadBlockstanbul m
                     , (Keccak256 `A.Alters` ChainHashEntry) m
                     , (Keccak256 `A.Alters` DependentBlockEntry) m
                     , (Keccak256 `A.Alters` (Proxy WireMessage)) m
                     )
                  => InEvent
                  -> ConduitT a SeqEvent m ()
blockstanbulSend' msg = do
  resp' <- sendAllMessages [msg]
  let blocks = [b | ToCommit b <- resp']
  resp <- (resp'++) <$>
      case blocks of
        [] -> return []
        -- TODO(tim): Block insertion can potentially fail, so there
        -- should be feedback here
        [b] -> sendAllMessages [CommitResult . Right . blockHash $ b]
        bs -> error $ "can send at most 1 block at a time: " ++ show bs
  mapM_ createNewTimer [rn | ResetTimer rn <- resp]
  rch <- Mod.access (Mod.Proxy @(TQueue VoteResult))
  atomically $ mapM_ (writeTQueue rch) [r | VoteResponse r <- resp]
  $logDebugS "seq/pbft/send" . T.pack $ "Pre-rewrite: " ++ format (map blockHash blocks)
  let getSequencedBlock = ingestBlockToSequencedBlock lookupChainIdFromChainHash
                        . blockToIngestBlock TO.Blockstanbul
      creates = [VmCreateBlockCommand | MakeBlockCommand <- resp]
  rBlocks <- catMaybes <$> traverse getSequencedBlock blocks
  vmBlocks <- catMaybes <$> traverse insertEmitted rBlocks
  let vmevs = creates
           ++ (VmBlock <$> vmBlocks)
           ++ [VmVoteToMake r d s| PendingVote r d s <- resp]
      p2pevs = [P2pBlockstanbul (WireMessage a m) | OMsg a m <- resp]
            ++ [P2pAskForBlocks (h+1) l p | GapFound h l p <- resp]
            ++ [P2pPushBlocks (l+1) h p | LeadFound h l p <- resp]
      ckpts = [ck | NewCheckpoint ck <- resp]

  unless (null blocks) $ do
    let tLast = blockHeaderTimestamp . BDB.blockBlockData . head $ blocks
    dt <- unBlockPeriod <$> Mod.access (Mod.Proxy @BlockPeriod)
    let tNext = addUTCTime dt tLast
    now <- liftIO getCurrentTime
    when (now < tNext) $
      liftIO . threadDelay . round $ 1e6 * diffUTCTime tNext now

  $logDebugS "seq/pbft/send_checkpoints" . T.pack $ show ckpts
  yieldMany $ ToUnseq <$> ckpts
  $logDebugS "seq/pbft/send_p2p" . T.pack $ format p2pevs
  yieldMany $ ToP2p <$> p2pevs
  $logDebugS "seq/pbft/send_vm" . T.pack $ format vmevs
  yieldMany $ ToVm <$> vmevs

privateWitnessableHash :: Keccak256 -> Keccak256 -> Keccak256
privateWitnessableHash tHash cHash =
  hash
  . RL.rlpSerialize
  $ RL.RLPArray [RL.rlpEncode tHash, RL.rlpEncode cHash]

transformPrivateHashTXs :: ( MonadLogger m
                           , HasPrivateHashDB m
                           , (Keccak256 `A.Alters` ChainHashEntry) m
                           , (Keccak256 `A.Alters` ()) m
                           )
                        => [(Timestamp, IngestTx)]
                        -> ConduitT a SeqEvent m ()
transformPrivateHashTXs pairs = forM_ pairs $ \(ts, t@(IngestTx _ (TD.PrivateHashTX th' ch'))) -> do
  motx <- wrapTransaction lookupChainIdFromChainHash t
  for_ motx $ \otx -> do
    let privateWitnessHash = privateWitnessableHash th' ch'
    pwitnessed <- wasTransactionHashWitnessed privateWitnessHash
    unless pwitnessed $ do
      witnessTransactionHash privateWitnessHash
      runPrivateHashTX th' ch'
      yield . ToP2p $ P2pTx otx
      yield . ToVm  $ VmTx ts otx

transformFullTransactions :: ( MonadLogger m
                             , MonadMonitor m
                             , HasFullPrivacy m
                             , (Keccak256 `A.Alters` ()) m
                             )
                          => [(Timestamp, IngestTx)]
                          -> ConduitT a SeqEvent m ()
transformFullTransactions pairs = do
  let logF = logFF "transformEvents/emitTxs"
  mOtxs <- forM pairs $ \(ts,itx) ->
    wrapTransaction lookupChainIdFromChainHash itx >>= \case
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
            return $ Just (ts,otx)
  let otxs = catMaybes mOtxs
  forM_ (partitionWith (isPrivateChainTX . otBaseTx . snd) otxs) $ \(isPrivateChain, txs) ->
    if not isPrivateChain
      then do
        logF $ "Sending " ++ show (length txs) ++ " public transactions to P2P and the VM"
        yieldMany $ (ToVm . pairToVmTx) <$> txs
        yieldMany $ (ToP2p . P2pTx . snd) <$> txs
      else forM_ (partitionWith (TD.transactionChainId . otBaseTx . snd) txs) $ \(Just chainId, ptxs) -> do
        logF . concat $
          [ "Transforming "
          , show (length txs)
          , " private transactions on chain "
          , CL.yellow $ format chainId
          ]
        mapM_ (insertTransaction . snd) ptxs
        yieldMany $ (ToVm . VmPrivateTx . snd) <$> ptxs -- we want to get these transactions into the
                                                        -- P2P indexer ASAP so we can return them to
                                                        -- peers requesting them
        mcInfo <- join . fmap _chainIdInfo <$> A.lookup (Proxy :: Proxy ChainIdEntry) chainId
        case mcInfo of
          Nothing -> do
            logF . concat $
              [ "We haven't seen the details for chain "
              , CL.yellow $ format chainId
              , ". Inserting the chain Id into the GetChains list"
              ]
            requestChain chainId
          Just cInfo -> do
            forM_ ptxs $ \(ts, ptx) -> do
              logF . concat $
                [ "We know the details for chain "
                , CL.yellow $ format chainId
                , ". Sending to P2P."
                ]
              yield . ToP2p $ P2pTx ptx
              --liftIO $ withLabel txMetrics "private_hash" incCounter
              when (otOrigin ptx == TO.API) $ do
                cHash <- getNewChainHash chainId >>= \case
                  Nothing -> do
                    let iHash = generateInitialChainHash cInfo
                    logF . concat $
                      [ "transformFullTransactions: "
                      , "Encountered empty chain hash buffer for chain ID "
                      , "Could not acquire new chain hash for chain ID "
                      , TD.formatChainId $ Just chainId
                      , ". Using initial chain hash instead: "
                      , format iHash
                      ]
                    return iHash
                  Just ch -> return ch
                let tHash = txHash ptx
                    th' = txHash ptx
                    ch' = cHash
                    phtx = ptx{otBaseTx = TD.PrivateHashTX th' ch'}
                    privateWitnessHash = privateWitnessableHash th' ch'
                witnessTransactionHash privateWitnessHash
                logF . concat $
                  [ "Created chain hash "
                  , format cHash
                  , " for transaction "
                  , format tHash
                  ]
                yield . ToVm $ pairToVmTx (ts, phtx)
                yield . ToP2p $ P2pTx phtx
            yieldMany . map (ToVm . VmBlock) =<< runBlocks chainId

transformTransactions :: ( MonadLogger m
                         , MonadMonitor m
                         , HasFullPrivacy m
                         , (Keccak256 `A.Alters` ()) m
                         )
                      => [(Timestamp, IngestTx)]
                      -> ConduitT a SeqEvent m ()
transformTransactions events = forM_ (partitionWith (isPrivateHashTX . itTransaction . snd) events) $ \(isPrivateHash, pairs) ->
  if isPrivateHash
    then transformPrivateHashTXs pairs
    else transformFullTransactions pairs

runBlockWithConsensus :: ( MonadLogger m
                         , MonadMonitor m
                         , MonadBlockstanbul m
                         , HasFullPrivacy m
                         , (Keccak256 `A.Alters` DependentBlockEntry) m
                         , (Keccak256 `A.Alters` (Proxy WireMessage)) m
                         )
                      => SequencedBlock
                      -> ConduitT a SeqEvent m ()
runBlockWithConsensus sb = do
  ses <- runConduit
    ( yield sb
   .| runConsensus
   .| hydrateAndEmit
   .| sinkList
    )
  yieldMany ses

expandBlock :: ( MonadLogger m
               , MonadMonitor m
               , (Keccak256 `A.Alters` DependentBlockEntry) m
               )
            => SequencedBlock
            -> m [OutputBlock]
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

runConsensus :: ( MonadLogger m
                , MonadMonitor m
                , MonadBlockstanbul m
                , (Keccak256 `A.Alters` ChainHashEntry) m
                , (Keccak256 `A.Alters` DependentBlockEntry) m
                , (Keccak256 `A.Alters` (Proxy WireMessage)) m
                )
             => ConduitT SequencedBlock SeqEvent m ()
runConsensus = awaitForever $ \sb -> do
  hasPBFT <- lift blockstanbulRunning
  if not hasPBFT
    then do
      obs <- lift $ expandBlock sb
      traverse_ (yield . ToP2p . P2pBlock) obs
      yieldMany $ ToVm . VmBlock <$> obs
    else do
      let blk = sequencedBlockToBlock sb
      routed <- if isHistoricBlock blk
                   then lift $ map (PreviousBlock . outputBlockToBlock) <$> expandBlock sb
                   else pure [UnannouncedBlock blk]
      -- Blockstanbul will check that the seals and validators match up before
      -- announcing it to the network or forwarding to the EVM.
      traverse_ blockstanbulSend' routed

hydrateAndEmit :: ( MonadLogger m
                  , MonadMonitor m
                  , HasFullPrivacy m
                  )
               => ConduitT SeqEvent SeqEvent m ()
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
      Nothing -> $logErrorS "hydrateAndEmit" . T.pack $
        "hydratePrivateHashes didn't return a block for the main chain. This probably means there is a bug in the platform"
      Just ob'' -> yield . ToVm $ VmBlock ob''
    -- use ob's origin because we don't hold on to chain's original origin
    transformGenesis . map (\(cId, info) -> IngestGenesis orig (cId, info)) $ M.toList chainsToEmit
    lift . A.adjustStatefully_ (A.Proxy @EmittedBlock) obHash $ blockDependentChains .= M.empty
  oe -> yield oe

transformBlocks :: ( MonadLogger m
                   , MonadMonitor m
                   , MonadBlockstanbul m
                   , HasFullPrivacy m
                   , (Keccak256 `A.Alters` DependentBlockEntry) m
                   , (Keccak256 `A.Alters` (Proxy WireMessage)) m
                   )
                => [IngestBlock]
                -> ConduitT a SeqEvent m ()
transformBlocks = mapM_ $ \ib -> ingestBlockToSequencedBlock lookupChainIdFromChainHash ib >>= \case
  Nothing -> do
    $logWarnS "transformEvents/emitBlocks" . T.pack
      $ "Could not ECRecover the pubkey of certain Txs in Block " ++ prettyIBlock ib ++ "; not emitting"
    P.incCounter seqBlocksEcrfail -- couldnt ecrecover some transactions in this block. block is likely garbage
  Just sb -> do
    runBlockWithConsensus sb

transformGenesis :: ( MonadLogger m
                    , MonadMonitor m
                    , HasFullPrivacy m
                    )
                 => [IngestGenesis]
                 -> ConduitT a SeqEvent m ()
transformGenesis chains = forM_ chains $ \ig -> do
  let logF = logFF "transformGenesis"
  let og = ingestGenesisToOutputGenesis ig
      (chainId, cInfo) = ogGenesisInfo og
  logF $ "Transforming ChainInfo for chain " ++ CL.yellow (format chainId) ++ " with info " ++ show cInfo
  lookupSeenChain chainId >>= \case
    True -> do
      logF "We've seen this chain before. Not emitting to VM"
      chainsToEmit <- maybe [] (M.toList . _chainDependentChains) <$> A.lookup (A.Proxy @ChainIdEntry) chainId
      transformGenesis $ map (\ci -> ig{igGenesisInfo = ci}) chainsToEmit
      lift . A.adjustStatefully_ (A.Proxy @ChainIdEntry) chainId $ chainDependentChains .= M.empty
    False -> do
      logF "We haven't seen this chain before. Inserting into SeenChainDB and emitting to VM, P2P"
      logF $ "Checking emission status of block " ++ format (creationBlock $ chainInfo cInfo)
      seenCreationBlock <- fmap _emitted . lift . A.repsert (A.Proxy @EmittedBlock) (creationBlock $ chainInfo cInfo) $ \case
        Nothing -> pure $ EmittedBlock False (M.singleton chainId cInfo)
        Just (EmittedBlock emitted' depChains) | emitted' -> pure $ EmittedBlock emitted' M.empty
                                               | otherwise -> pure $ EmittedBlock emitted' (M.insert chainId cInfo depChains)
      logF $ "Emission status of block " ++ format (creationBlock $ chainInfo cInfo) ++ ": " ++ show seenCreationBlock
      let parentChainId = parentChain $ chainInfo cInfo
      seenParentChains <- hasAllAncestorChains parentChainId
      logF $ "hasAllAncestorChains: " ++ show seenParentChains
      if seenParentChains
        then when seenCreationBlock $ do
          yield . ToVm $ VmGenesis og
          yield . ToP2p $ P2pGenesis og
          yieldMany . map (ToVm . VmBlock) =<< insertNewChainInfo chainId cInfo
          chainsToEmit <- maybe [] (M.toList . _chainDependentChains) <$> A.lookup (A.Proxy @ChainIdEntry) chainId
          transformGenesis $ map (\ci -> ig{igGenesisInfo = ci}) chainsToEmit
          lift . A.adjustStatefully_ (A.Proxy @ChainIdEntry) chainId $ chainDependentChains .= M.empty
        else case parentChainId of
          Nothing -> $logErrorS "transformGenesis" . T.pack $ concat
            [ "The database claims to be missing parent chain info for chain "
            , format chainId
            , ", but its parent chain is the main chain. This probably means there is a bug in the platform."
            ]
          Just pChain -> A.repsert_ (A.Proxy @ChainIdEntry) pChain $ \case
               Nothing -> pure $ ChainIdEntry Nothing emptyCircularBuffer S.empty $ M.singleton chainId cInfo
               Just cie@ChainIdEntry{..} -> pure $ cie & chainDependentChains %~ M.insert chainId cInfo

splitEvents :: ( MonadLogger m
               , MonadMonitor m
               , MonadBlockstanbul m
               , HasFullPrivacy m
               , (Keccak256 `A.Alters` DependentBlockEntry) m
               , (Keccak256 `A.Alters` ()) m
               , (Keccak256 `A.Alters` (Proxy WireMessage)) m
               )
            => [IngestEvent]
            -> ConduitT a SeqEvent m ()
splitEvents es = forM_ (splitWith iEventType es) $ \(eventType, events) ->
  let num = length events
      record :: (MonadIO m, MonadLogger m) => T.Text -> T.Text -> m ()
      record t k = do
        liftIO $ withLabel eventsplitMetrics t (flip unsafeAddCounter . fromIntegral $ num)
        $logInfoS "splitEvents" . T.pack $ printf "Running %d %s" num k
  in case eventType of
    IETTransaction -> do
      record "inevent_type_transaction" "IngestTransactions"
      transformTransactions $ map (\(IETx ts tx) -> (ts,tx)) events
    IETBlock -> do
      record "inevent_type_block" "IngestBlocks"
      transformBlocks $ map (\(IEBlock ob) -> ob) events
    IETGenesis -> do
      record "inevent_type_genesis" "IngestGenesises"
      transformGenesis $ map (\(IEGenesis og) -> og) events
    IETNewChainMember -> do
      record "inevent_type_new_chain_member" "IngestNewChainMembers"
      yieldMany $ map (\(IENewChainMember c a e) -> ToP2p $ P2pNewChainMember c a e) events
    IETBlockstanbul -> do
      record "inevent_type_blockstanbul" "IngestBlockstanbuls"
      blockstanbulSend $ map (\(IEBlockstanbul (WireMessage a m)) -> IMsg a m) events
    IETForcedConfigChange -> do
      record "inevent_type_forced_config_change" "ForcedConfigChanges"
      blockstanbulSend $ map (\(IEForcedConfigChange cc) -> ForcedConfigChange cc) events

prettyIBlock :: IngestBlock -> String
prettyIBlock IngestBlock{ibOrigin=o,ibBlockData=bd,ibReceiptTransactions=txs} = "Block #" ++ blockNonce ++ "/" ++ bHash ++ " (via " ++ format o ++ ", " ++ show (length txs) ++ " txs)"
  where blockNonce = show . BDB.blockDataNumber $ bd
        bHash  = format . BDB.blockHeaderHash $ bd

prettyOBlock :: OutputBlock -> String
prettyOBlock OutputBlock{obOrigin=o,obBlockData=bd,obReceiptTransactions=txs} = "Block #" ++ blockNonce ++ "/" ++ bHash ++ " (via " ++ format o ++ ", " ++ show (length txs) ++ " txs)"
  where blockNonce = show . BDB.blockDataNumber $ bd
        bHash  = format . BDB.blockHeaderHash $ bd

prettyBlock :: SequencedBlock -> String
prettyBlock SequencedBlock{sbOrigin=o,sbBlockData=bd,sbReceiptTransactions=txs} = "Block #" ++ blockNonce ++ "/" ++ bHash ++ " (via " ++ format o ++ ", " ++ show (length txs) ++ " txs)"
  where blockNonce = show . BDB.blockDataNumber $ bd
        bHash  = format . BDB.blockHeaderHash $ bd

prettyTx :: IngestTx -> String
prettyTx IngestTx{itOrigin=o, itTransaction=t} = prefix t ++ " via " ++ shortOrigin o
      where prefix TD.MessageTX{}          = "MessageTx [" ++ (format $ txHash t) ++ "]"
            prefix TD.ContractCreationTX{} = "CreationTx[" ++ (format $ txHash t) ++ "]"
            prefix TD.PrivateHashTX{}    = "PrivateHashTx[" ++ (format $ txHash t) ++ "]"

            shortOrigin (TO.PeerString peer) = "Peer " ++ take 8 peer
            shortOrigin x                    = format x

prettyOTx :: OutputTx -> String
prettyOTx OutputTx{otOrigin=o, otBaseTx=t} = prefix t ++ " via " ++ shortOrigin o
      where prefix TD.MessageTX{}          = "MessageTx [" ++ (format $ txHash t) ++ "]"
            prefix TD.ContractCreationTX{} = "CreationTx[" ++ (format $ txHash t) ++ "]"
            prefix TD.PrivateHashTX{}    = "PrivateHashTx[" ++ (format $ txHash t) ++ "]"

            shortOrigin (TO.PeerString peer) = "Peer " ++ take 8 peer
            shortOrigin x                    = format x

writeUnseqCheckpoints :: [Checkpoint] -> SequencerM ()
writeUnseqCheckpoints events = do
    ch <- asks (unseqCheckpoints . cablePackage)
    atomically . mapM_ (writeTQueue ch) $ events

writeSeqVmEvents :: [VmEvent] -> SequencerM ()
writeSeqVmEvents events = do
    ch <- asks (seqVMEvents . cablePackage)
    atomically . mapM_ (writeTQueue ch) $ events

writeSeqP2pEvents :: [P2pEvent] -> SequencerM ()
writeSeqP2pEvents events = do
    ch <- asks (seqP2PEvents . cablePackage)
    atomically . mapM_ (writeTQueue ch) $ events
