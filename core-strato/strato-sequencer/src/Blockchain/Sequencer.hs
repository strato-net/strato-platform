{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TupleSections     #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}
module Blockchain.Sequencer where

import           ClassyPrelude                             (atomically)
import           Conduit
import           Control.Concurrent                        hiding (yield)
import           Control.Concurrent.STM.TMChan
import           Control.Concurrent.STM.TQueue
import           Control.Concurrent.STM.TBQueue
import           Blockchain.Output
import           Control.Lens
import qualified Control.Monad.Change.Alter                as A
import qualified Control.Monad.Change.Modify               as Mod
import           Control.Monad.Reader
import           Control.Monad.State
import           Control.Monad.IO.Class                    (liftIO)

import           Data.ByteString.Char8                     (pack)
import           Data.ByteString.Base16                    as B16
import           Data.Foldable
import           Data.IORef
import           Data.Maybe
import           Data.Proxy
import qualified Data.Sequence                             as Q
import qualified Data.Set                                  as S
import qualified Data.Text                                 as T
import           Data.Time.Clock
import           Prometheus                                as P
import           Text.Printf

import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.HTTPAdmin         as API
import           Blockchain.ExtWord
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

import qualified Blockchain.Data.BlockDB                   as BDB
import qualified Blockchain.Data.TransactionDef            as TD
import qualified Blockchain.Data.TXOrigin                  as TO
import qualified Blockchain.Data.RLP                       as RL

import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA

import           Blockchain.Util
import qualified Text.Colors                               as CL
import           Text.Format

logFF :: MonadLogger m => T.Text -> String -> m ()
logFF str = $logInfoS str . T.pack
-- replace with this when debugging tests
--logFF str msg = void . return $! traceShowId $! trace (T.unpack str) msg

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
  checkForVotes [cr | VoteMade cr <- events]
  checkForTimeouts [rn | TimerFire rn <- events]
  checkForUnseq [iev | UnseqEvent iev <- events]
  prunePrivacyDBs
  vmEvs <- drainVM
  unless (null vmEvs) $ do
    writeSeqVmEvents vmEvs
    $logDebugS "sequencer" . T.pack $ "Wrote " ++ format vmEvs ++ " SeqEvents to VM"
  p2pEvs <- drainP2P
  unless (null p2pEvs) $ do
    writeSeqP2pEvents p2pEvs
    $logDebugS "sequencer" . T.pack $ "Wrote " ++ format p2pEvs ++ " SeqEvents to P2P"
  ckpts <- drainCheckpoints
  unless (null ckpts) $ writeUnseqCheckpoints ckpts
  flush
  return src'

flush :: SequencerM ()
flush = flushLdbBatchOps
     >> clearDBERegistry
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

checkForVotes :: [CandidateReceived] -> SequencerM ()
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

checkForTimeouts :: [RoundNumber] -> SequencerM ()
checkForTimeouts rns = do
  withLabel seqLoopEvents "timeout" (flip unsafeAddCounter . fromIntegral . length $ rns)
  blockstanbulSend . map Timeout $ rns

checkForUnseq :: [IngestEvent] -> SequencerM ()
checkForUnseq inEvents = do
    let logF = logFF "checkForUnseq"
    withLabel seqLoopEvents "unseq" (flip unsafeAddCounter . fromIntegral . length $ inEvents)
    timeAction seqSplitEventsTiming $ splitEvents inEvents
    pendingLDBWrites <- gets _ldbBatchOps
    applyLDBBatchWrites $ toList pendingLDBWrites
    P.incCounter seqLdbBatchWrites
    P.setGauge seqLdbBatchSize . fromIntegral . length $ pendingLDBWrites
    logF "Applied pending LDB writes"
    chainIds <- unGetChainsDB <$> use getChainsDB
    unless (S.null chainIds) $
      markForP2P . P2pGetChain $ toList chainIds
    txHashes <- unGetTransactionsDB <$> use getTransactionsDB
    unless (S.null txHashes) $
      markForP2P . P2pGetTx $ toList txHashes

bootstrapBlockstanbul :: SequencerM ()
bootstrapBlockstanbul = do
  writeSeqVmEvents [VmCreateBlockCommand]
  createFirstTimer

blockstanbulSend :: ( MonadIO m
                    , MonadLogger m
                    , MonadMonitor m
                    , HasBlockstanbulContext m
                    , HasPrivateHashDB m
                    , Mod.Accessible (IORef RoundNumber) m
                    , Mod.Accessible (TMChan RoundNumber) m
                    , Mod.Accessible BlockPeriod m
                    , Mod.Accessible RoundPeriod m
                    , Mod.Accessible (TQueue VoteResult) m
                    , Mod.Modifiable (Q.Seq VmEvent) m
                    , Mod.Modifiable (Q.Seq P2pEvent) m
                    , Mod.Modifiable (Q.Seq Checkpoint) m
                    , (SHA `A.Alters` OutputTx) m
                    , (SHA `A.Alters` OutputBlock) m
                    , (SHA `A.Alters` ChainHashEntry) m
                    , (Word256 `A.Alters` ChainIdEntry) m
                    , (SHA `A.Alters` DependentBlockEntry) m
                    )
                 => [InEvent]
                 -> m ()
blockstanbulSend = mapM_ $ \ie -> do
  oes <- blockstanbulSend' ie
  mapM_ markForVM =<< runConduit
    ( yieldMany oes
   .| hydrateAndEmit Nothing
   .| sinkList
    )

blockstanbulSend' :: ( MonadIO m
                     , MonadLogger m
                     , HasBlockstanbulContext m
                     , Mod.Accessible (IORef RoundNumber) m
                     , Mod.Accessible (TMChan RoundNumber) m
                     , Mod.Accessible BlockPeriod m
                     , Mod.Accessible RoundPeriod m
                     , Mod.Accessible (TQueue VoteResult) m
                     , Mod.Modifiable (Q.Seq P2pEvent) m
                     , Mod.Modifiable (Q.Seq Checkpoint) m
                     , (SHA `A.Alters` ChainHashEntry) m
                     , (SHA `A.Alters` DependentBlockEntry) m
                     )
                  => InEvent
                  -> m [VmEvent]
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
  mapM_ markCheckpoint ckpts
  $logDebugS "seq/pbft/send_p2p" . T.pack $ format p2pevs
  mapM_ markForP2P p2pevs
  $logDebugS "seq/pbft/send_vm" . T.pack $ format vmevs
  return vmevs

privateWitnessableHash :: SHA -> SHA -> SHA
privateWitnessableHash tHash cHash =
  hash
  . RL.rlpSerialize
  $ RL.RLPArray [RL.rlpEncode tHash, RL.rlpEncode cHash]

transformPrivateHashTXs :: ( MonadLogger m
                           , HasPrivateHashDB m
                           , Mod.Modifiable (Q.Seq VmEvent) m
                           , Mod.Modifiable (Q.Seq P2pEvent) m
                           , (SHA `A.Alters` ChainHashEntry) m
                           , (SHA `A.Alters` ()) m
                           )
                        => [(Timestamp, IngestTx)]
                        -> m ()
transformPrivateHashTXs pairs = forM_ pairs $ \(ts, t@(IngestTx _ (TD.PrivateHashTX th' ch'))) -> do
  motx <- wrapTransaction lookupChainIdFromChainHash t
  for_ motx $ \otx -> do
    let privateWitnessHash = privateWitnessableHash th' ch'
    pwitnessed <- wasTransactionHashWitnessed privateWitnessHash
    unless pwitnessed $ do
      witnessTransactionHash privateWitnessHash
      runPrivateHashTX th' ch'
      markForP2P $ P2pTx otx
      markForVM  $ VmTx ts otx

transformFullTransactions :: ( MonadLogger m
                             , MonadMonitor m
                             , HasPrivateHashDB m
                             , Mod.Modifiable GetChainsDB m
                             , Mod.Modifiable (Q.Seq VmEvent) m
                             , Mod.Modifiable (Q.Seq P2pEvent) m
                             , (SHA `A.Alters` OutputTx) m
                             , (SHA `A.Alters` OutputBlock) m
                             , (SHA `A.Alters` ChainHashEntry) m
                             , (SHA `A.Alters` ()) m
                             , (Word256 `A.Alters` ChainIdEntry) m
                             )
                          => [(Timestamp, IngestTx)]
                          -> m ()
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
        mapM_ (markForVM . pairToVmTx) txs
        mapM_ (markForP2P . P2pTx . snd) txs
      else forM_ (partitionWith (TD.transactionChainId . otBaseTx . snd) txs) $ \(Just chainId, ptxs) -> do
        logF . concat $
          [ "Transforming "
          , show (length txs)
          , " private transactions on chain "
          , CL.yellow $ format chainId
          ]
        mapM_ (insertTransaction . snd) ptxs
        mapM_ (markForVM . VmPrivateTx . snd) ptxs -- we want to get these transactions into the
                                                   -- P2P indexer ASAP so we can return them to
                                                   -- peers requesting them
        mcInfo <- fmap _chainIdInfo <$> A.lookup (Proxy :: Proxy ChainIdEntry) chainId
        case mcInfo of
          Nothing -> do
            logF . concat $
              [ "We haven't seen the details for chain "
              , CL.yellow $ format chainId
              , ". Inserting the chain Id into the GetChains list"
              ]
            insertGetChainsDB chainId
          Just cInfo -> do
            forM_ ptxs $ \(ts, ptx) -> do
              logF . concat $
                [ "We know the details for chain "
                , CL.yellow $ format chainId
                , ". Sending to P2P."
                ]
              markForP2P $ P2pTx ptx
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
                markForVM $ pairToVmTx (ts, phtx)
                markForP2P $ P2pTx phtx
            mapM_ (markForVM . VmBlock) =<< runBlocks chainId

transformTransactions :: ( MonadLogger m
                         , MonadMonitor m
                         , HasPrivateHashDB m
                         , Mod.Modifiable GetChainsDB m
                         , Mod.Modifiable (Q.Seq VmEvent) m
                         , Mod.Modifiable (Q.Seq P2pEvent) m
                         , (SHA `A.Alters` OutputTx) m
                         , (SHA `A.Alters` OutputBlock) m
                         , (SHA `A.Alters` ChainHashEntry) m
                         , (SHA `A.Alters` ()) m
                         , (Word256 `A.Alters` ChainIdEntry) m
                         )
                      => [(Timestamp, IngestTx)]
                      -> m ()
transformTransactions events = forM_ (partitionWith (isPrivateHashTX . itTransaction . snd) events) $ \(isPrivateHash, pairs) ->
  if isPrivateHash
    then transformPrivateHashTXs pairs
    else transformFullTransactions pairs

runBlockWithConsensus :: ( MonadIO m
                         , MonadLogger m
                         , MonadMonitor m
                         , HasBlockstanbulContext m
                         , HasPrivateHashDB m
                         , Mod.Accessible (IORef RoundNumber) m
                         , Mod.Accessible (TMChan RoundNumber) m
                         , Mod.Accessible BlockPeriod m
                         , Mod.Accessible RoundPeriod m
                         , Mod.Accessible (TQueue VoteResult) m
                         , Mod.Modifiable (Q.Seq VmEvent) m
                         , Mod.Modifiable (Q.Seq P2pEvent) m
                         , Mod.Modifiable (Q.Seq Checkpoint) m
                         , (SHA `A.Alters` OutputTx) m
                         , (SHA `A.Alters` OutputBlock) m
                         , (SHA `A.Alters` ChainHashEntry) m
                         , (Word256 `A.Alters` ChainIdEntry) m
                         , (SHA `A.Alters` DependentBlockEntry) m
                         )
                      => SequencedBlock
                      -> m ()
runBlockWithConsensus sb =
  mapM_ markForVM =<< runConduit
    ( yield sb
   .| runConsensus
   .| hydrateAndEmit Nothing
   .| sinkList
    )

expandBlock :: ( MonadLogger m
               , MonadMonitor m
               , (SHA `A.Alters` DependentBlockEntry) m
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

runConsensus :: ( MonadIO m
                , MonadLogger m
                , MonadMonitor m
                , HasBlockstanbulContext m
                , Mod.Accessible (IORef RoundNumber) m
                , Mod.Accessible (TMChan RoundNumber) m
                , Mod.Accessible BlockPeriod m
                , Mod.Accessible RoundPeriod m
                , Mod.Accessible (TQueue VoteResult) m
                , Mod.Modifiable (Q.Seq P2pEvent) m
                , Mod.Modifiable (Q.Seq Checkpoint) m
                , (SHA `A.Alters` ChainHashEntry) m
                , (SHA `A.Alters` DependentBlockEntry) m
                )
             => ConduitM SequencedBlock VmEvent m ()
runConsensus = awaitForever $ \sb -> do
  hasPBFT <- lift $ blockstanbulRunning
  if not hasPBFT
    then do
      obs <- lift $ expandBlock sb
      lift $ traverse_ (markForP2P . P2pBlock) obs
      yieldMany $ VmBlock <$> obs
    else do
      let blk = sequencedBlockToBlock sb
      routed <- if isHistoricBlock blk
                   then lift $ map (PreviousBlock . outputBlockToBlock) <$> expandBlock sb
                   else pure [UnannouncedBlock blk]
      -- Blockstanbul will check that the seals and validators match up before
      -- announcing it to the network or forwarding to the EVM.
      traverse_ (yieldMany <=< lift . blockstanbulSend') routed

hydrateAndEmit :: ( MonadLogger m
                  , MonadMonitor m
                  , HasPrivateHashDB m
                  , (SHA `A.Alters` OutputTx) m
                  , (SHA `A.Alters` OutputBlock) m
                  , (SHA `A.Alters` ChainHashEntry) m
                  , (Word256 `A.Alters` ChainIdEntry) m
                  )
               => Maybe Word256
               -> ConduitM VmEvent VmEvent m ()
hydrateAndEmit chainId = awaitForever $ \case
  VmBlock ob -> do
    when (isNothing chainId) . yield $ VmBlock ob
    ob' <- lift $ hydratePrivateHashes chainId ob
    for_ ob' $ yield . VmBlock
  oe -> yield oe

transformBlocks :: ( MonadIO m
                   , MonadLogger m
                   , MonadMonitor m
                   , HasBlockstanbulContext m
                   , HasPrivateHashDB m
                   , Mod.Accessible (IORef RoundNumber) m
                   , Mod.Accessible (TMChan RoundNumber) m
                   , Mod.Accessible BlockPeriod m
                   , Mod.Accessible RoundPeriod m
                   , Mod.Accessible (TQueue VoteResult) m
                   , Mod.Modifiable (Q.Seq VmEvent) m
                   , Mod.Modifiable (Q.Seq P2pEvent) m
                   , Mod.Modifiable (Q.Seq Checkpoint) m
                   , (SHA `A.Alters` OutputTx) m
                   , (SHA `A.Alters` OutputBlock) m
                   , (SHA `A.Alters` ChainHashEntry) m
                   , (Word256 `A.Alters` ChainIdEntry) m
                   , (SHA `A.Alters` DependentBlockEntry) m
                   )
                => [IngestBlock]
                -> m ()
transformBlocks = mapM_ $ \ib -> ingestBlockToSequencedBlock lookupChainIdFromChainHash ib >>= \case
  Nothing -> do
    $logWarnS "transformEvents/emitBlocks" . T.pack
      $ "Could not ECRecover the pubkey of certain Txs in Block " ++ prettyIBlock ib ++ "; not emitting"
    P.incCounter seqBlocksEcrfail -- couldnt ecrecover some transactions in this block. block is likely garbage
  Just sb -> do
    runBlockWithConsensus sb

transformGenesis :: ( MonadLogger m
                    , MonadMonitor m
                    , HasPrivateHashDB m
                    , Mod.Modifiable (Q.Seq VmEvent) m
                    , Mod.Modifiable (Q.Seq P2pEvent) m
                    , (SHA `A.Alters` OutputTx) m
                    , (SHA `A.Alters` OutputBlock) m
                    , (SHA `A.Alters` ChainHashEntry) m
                    , (Word256 `A.Alters` ChainIdEntry) m
                    )
                 => [IngestGenesis]
                 -> m ()
transformGenesis chains = forM_ chains $ \ig -> do
  let logF = logFF "transformGenesis"
  let og = ingestGenesisToOutputGenesis ig
      (chainId, cInfo) = ogGenesisInfo og
  logF $ "Transforming ChainInfo for chain " ++ CL.yellow (format chainId) ++ " with info " ++ show cInfo
  lookupSeenChain chainId >>= \case
    True -> logF "We've seen this chain before. Not emitting to VM"
    False -> do
      logF "We haven't seen this chain before. Inserting into SeenChainDB and emitting to VM, P2P"
      markForVM $ VmGenesis og
      markForP2P (P2pGenesis og)
      mapM_ (markForVM . VmBlock) =<< insertNewChainInfo chainId cInfo

splitEvents :: ( MonadIO m
               , MonadLogger m
               , MonadMonitor m
               , HasBlockstanbulContext m
               , HasPrivateHashDB m
               , Mod.Accessible (IORef RoundNumber) m
               , Mod.Accessible (TMChan RoundNumber) m
               , Mod.Accessible BlockPeriod m
               , Mod.Accessible RoundPeriod m
               , Mod.Accessible (TQueue VoteResult) m
               , Mod.Modifiable GetChainsDB m
               , Mod.Modifiable (Q.Seq VmEvent) m
               , Mod.Modifiable (Q.Seq P2pEvent) m
               , Mod.Modifiable (Q.Seq Checkpoint) m
               , (SHA `A.Alters` DependentBlockEntry) m
               , (SHA `A.Alters` OutputTx) m
               , (SHA `A.Alters` OutputBlock) m
               , (SHA `A.Alters` ChainHashEntry) m
               , (Word256 `A.Alters` ChainIdEntry) m
               , (SHA `A.Alters` ()) m
               )
            => [IngestEvent]
            -> m ()
splitEvents es = forM_ (partitionWith iEventType es) $ \(eventType, events) ->
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
      mapM_ (\(IENewChainMember c a e) -> markForP2P $ P2pNewChainMember c a e) events
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
