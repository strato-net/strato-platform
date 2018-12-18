{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TupleSections     #-}
module Blockchain.Sequencer where

import           ClassyPrelude                             (atomically)
import           Conduit
import           Control.Concurrent                        hiding (yield)
import           Control.Concurrent.STM.TQueue
import           Control.Lens
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.State
import           Control.Monad.IO.Class                    (liftIO)

import           Data.ByteString.Char8                     (pack)
import           Data.ByteString.Base16                    as B16
import           Data.Foldable
import           Data.Maybe
import qualified Data.Sequence                             as Q
import qualified Data.Set                                  as S
import qualified Data.Text                                 as T
import           Data.Time.Clock
import           Data.Traversable                          (for)
import           Prometheus                                as P
import           Text.Printf

import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.HTTPAdmin         as API
import           Blockchain.ExtWord
import           Blockchain.Format
import           Blockchain.Sequencer.CablePackage
import           Blockchain.Sequencer.DB.ChainHashDB
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.DB.GetChainsDB
import           Blockchain.Sequencer.DB.GetTransactionsDB
import           Blockchain.Sequencer.DB.MissingTxDB
import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.PrivateTxDB
import           Blockchain.Sequencer.DB.SeenChainDB
import           Blockchain.Sequencer.DB.SeenBlockDB
import           Blockchain.Sequencer.DB.SeenTransactionDB
import           Blockchain.Sequencer.DB.Witnessable
import           Blockchain.Sequencer.Event

import           Blockchain.Sequencer.Metrics
import           Blockchain.Sequencer.Monad

import qualified Blockchain.Data.BlockDB                   as BDB
import qualified Blockchain.Data.Transaction               as TX
import qualified Blockchain.Data.TransactionDef            as TD
import qualified Blockchain.Data.TXOrigin                  as TO
import qualified Blockchain.Data.RLP                       as RL

import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA

import           Blockchain.Util

logFF :: MonadLogger m => T.Text -> String -> m ()
logFF str = $logInfoS str . T.pack
-- replace with this when debugging tests
-- logFF str msg = void . return $! traceShowId $! trace (T.unpack str) msg

sequencer :: SequencerM ()
sequencer = do
  let logF = logFF "sequencer"
  logF "Sequencer startup"
  source <- sealConduitT <$> fuseChannels
  bootstrapBlockstanbul
  logF "Sequencer initialized"
  go source
 where
  go :: SealedConduitT () SeqLoopEvent SequencerM () -> SequencerM ()
  go src = oneSequencerIter src >>= go

oneSequencerIter :: SealedConduitT () SeqLoopEvent SequencerM () -> SequencerM (SealedConduitT () SeqLoopEvent SequencerM ())
oneSequencerIter src = timeAction seqLoopTiming $ do
  clearAll
  (src', events) <- readEventsInBufferedWindow src
  checkForVotes [cr | VoteMade cr <- events]
  checkForTimeouts [rn | TimerFire rn <- events]
  checkForUnseq [iev | UnseqEvent iev <- events]
  vmEvs <- drainVM
  unless (null vmEvs) $ do
    writeSeqVmEvents vmEvs
    $logDebugS "sequencer" . T.pack $ "Wrote " ++ show vmEvs ++ " SeqEvents to VM"
  p2pEvs <- drainP2P
  unless (null p2pEvs) $ do
    writeSeqP2pEvents p2pEvs
    $logDebugS "sequencer" . T.pack $ "Wrote " ++ show p2pEvs ++ " SeqEvents to P2P"
  return src'

clearAll :: SequencerM ()
clearAll = clearLdbBatchOps >> clearGetChainsDB >> clearGetTransactionsDB

readEventsInBufferedWindow :: SealedConduitT () SeqLoopEvent SequencerM () -> SequencerM (SealedConduitT () SeqLoopEvent SequencerM (), [SeqLoopEvent])
readEventsInBufferedWindow src = do
  let logF = logFF "sequencer/events"
  logF "Reading from fused channels..."
  dt <- asks maxUsPerIter
  uch <- asks $ unseqEvents . cablePackage
  top <- atomically . tryPeekTQueue $ uch
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
  $logDebugS "sequencer/events" . T.pack . show $ events
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
                      . B16.decode $ pack (API.signature br)
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
    chainIds <- gets _getChainsDB
    unless (S.null chainIds) $
      markForP2P . OEGetChain $ toList chainIds
    txHashes <- gets _getTransactionsDB
    unless (S.null txHashes) $
      markForP2P . OEGetTx $ toList txHashes

bootstrapBlockstanbul :: SequencerM ()
bootstrapBlockstanbul = do
  writeSeqVmEvents [OECreateBlockCommand]
  createFirstTimer

blockstanbulSend :: [InEvent] -> SequencerM ()
blockstanbulSend = mapM_ (mapM_ markForVM <=< blockstanbulSend')

blockstanbulSend' :: InEvent -> SequencerM [OutputEvent]
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
  $logDebugS "seq/pbft/send" . T.pack $ "Pre-rewrite: " ++ show blocks
  let getSequencedBlock = ingestBlockToSequencedBlock . blockToIngestBlock TO.Blockstanbul
      rewriteBlock b = do
        let msb = getSequencedBlock b
        for msb $ \sb -> do
          witnessBlockHash (blockHeaderHash $ sbBlockData sb) sb
          return . OEBlock $ sequencedBlockToOutputBlock sb 1
      creates = [OECreateBlockCommand | MakeBlockCommand <- resp]
  rBlocks <- fmap catMaybes $ mapM rewriteBlock blocks
  let vmevs = creates ++ rBlocks
      p2pevs = [OEBlockstanbul (WireMessage a m) | OMsg a m <- resp]
            ++ [OEAskForBlocks (h+1) l p | GapFound h l p <- resp]
            ++ [OEPushBlocks (l+1) h p | LeadFound h l p <- resp]

  unless (null blocks) $ do
    let tLast = blockHeaderTimestamp . BDB.blockBlockData . head $ blocks
    dt <- asks blockstanbulBlockPeriod
    let tNext = addUTCTime dt tLast
    now <- liftIO getCurrentTime
    when (now < tNext) $
      liftIO . threadDelay . round $ 1e6 * diffUTCTime tNext now
  $logDebugS "seq/pbft/send_p2p" . T.pack . show $ p2pevs
  mapM_ markForP2P p2pevs
  $logDebugS "seq/pbft/send_vm" . T.pack . show $ vmevs
  return vmevs

checkIfIsMissingTX :: SHA -> SHA -> SequencerM ()
checkIfIsMissingTX th ch = do
  let logF = logFF "runPrivateHashTX"
  mChainId <- join . fmap _onChainId <$> getChainHashEntry ch
  case mChainId of
    Nothing -> do
      logF "We don't know this transaction's chain Id. Oh well..."
      return ()
    Just chainId -> do
      logF . concat $
        [ "We know this transaction's chain Id. It's "
        , format (SHA chainId)
        , ". Inserting into MissingTxDB and GetTransactions list"
        ]
      useChainHash ch
      insertMissingTx th
      insertGetTransactionsDB th

runPrivateHashTX :: SHA -> SHA -> SequencerM ()
runPrivateHashTX tHash cHash = do
  let logF = logFF "runPrivateHashTX"
  logF . concat $
    [ "Transforming transaction "
    , format tHash
    , " with chain hash "
    , format cHash
    ]
  repsertTxHashEntry_ tHash $ \case
    Nothing -> do
      logF "Transaction hash not seen before! Inserting it into SeenTxHashDB"
      checkIfIsMissingTX tHash cHash
      return $ txHashEntryWithChainHash cHash
    Just the -> do
      logF "Transaction hash seen before!"
      let the' = (chainHash .~ Just cHash) the
      void $ case _outputTx the' of
        Just tx -> do
          logF $ "We have this transaction's body. It's: " ++ prettyOTx tx
          useChainHash cHash
        Nothing -> do
          logF "We don't have this transaction's body. Looking it up by chain hash"
          checkIfIsMissingTX tHash cHash
      return the'
  repsertChainHashEntry_ cHash $ \case
    Nothing -> return $ chainHashEntryWithTxHash tHash
    Just che -> return $ (transactions %~ S.insert tHash) che

transformPrivateHashTXs :: [(Timestamp, IngestTx)] -> SequencerM ()
transformPrivateHashTXs pairs = forM_ pairs $ \(ts, t@(IngestTx _ (TD.PrivateHashTX th' ch'))) -> do
  for_ (wrapTransaction t) $ \otx -> do
    let witnessHash = witnessableHash otx
    witnessed <- wasTransactionHashWitnessed witnessHash
    unless witnessed $ do
      let privateWitnessHash =
            superProprietaryStratoSHAHash
            . RL.rlpSerialize
            $ RL.RLPArray [RL.rlpEncode th', RL.rlpEncode ch']
      pwitnessed <- wasTransactionHashWitnessed privateWitnessHash
      unless pwitnessed $ do
        witnessTransactionHash privateWitnessHash
        runPrivateHashTX (SHA th') (SHA ch')
        markForP2P $ OETx ts otx
        markForVM  $ OETx ts otx

transformFullTransactions :: [(Timestamp, IngestTx)] -> SequencerM ()
transformFullTransactions pairs = do
  let logF = logFF "transformEvents/emitTxs"
  mOtxs <- forM pairs $ \(ts,itx) ->
    case wrapTransaction itx of
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
        mapM_ (markForVM . pairToOETx) txs
        mapM_ (markForP2P . pairToOETx) txs
      else forM_ (partitionWith (TD.transactionChainId . otBaseTx . snd) txs) $ \(Just chainId, ptxs) -> do
        logF . concat $
          [ "Transforming "
          , show (length txs)
          , " private transactions on chain "
          , format (SHA chainId)
          ]
        mapM_ (insertTransaction . snd) ptxs
        mcie <- getChainIdEntry chainId
        let mcInfo = join $ fmap _chainInfo mcie
        case mcInfo of
          Nothing -> do
            logF . concat $
              [ "We haven't seen the details for chain "
              , format (SHA chainId)
              , ". Inserting the chain Id into the GetChains list"
              ]
            insertGetChainsDB chainId
          Just _ -> do
            forM_ ptxs $ \(ts, ptx) -> do
              logF . concat $
                [ "We know the details for chain "
                , format (SHA chainId)
                , ". Inserting "
                , prettyOTx ptx
                , "into PrivateHashDB"
                ]
              let tHash = txHash ptx
              markForP2P $ pairToOETx (ts, ptx)
              repsertTxHashEntry_ tHash $ \entry -> do
                let the = case entry of
                      Nothing -> txHashEntryWithOutputTx ptx
                      Just e -> (outputTx .~ Just ptx) e
                case _chainHash the of
                  Just _ -> do
                    logF $ "We have seen this transaction's PrivateHashTX before."
                    return the
                  Nothing -> do
                    insertPrivateHash ptx
                    if otOrigin ptx /= TO.API
                      then return the
                      else do
                        cHash <- getNewChainHash chainId
                        logF . concat $
                          [ "Created chain hash "
                          , format cHash
                          , " for transaction "
                          , format tHash
                          ]
                        let SHA th' = tHash
                            SHA ch' = cHash
                            phtx = ptx{otBaseTx = TD.PrivateHashTX th' ch'}
                        markForVM $ pairToOETx (ts, phtx)
                        markForP2P $ pairToOETx (ts, phtx)
                        return $ (chainHash .~ Just cHash) the
            runBlocks chainId

transformTransactions :: [(Timestamp, IngestTx)] -> SequencerM ()
transformTransactions events = forM_ (partitionWith (isPrivateHashTX . itTransaction . snd) events) $ \(isPrivateHash, pairs) ->
  if isPrivateHash
    then transformPrivateHashTXs pairs
    else transformFullTransactions pairs

runBlockWithConsensus :: SequencedBlock -> SequencerM ()
runBlockWithConsensus sb =
  mapM_ markForVM =<< runConduit
    ( yield sb
   .| expandBlock
   .| runConsensus
   .| hydrateAndEmit Nothing
   .| sinkList
    )

runBlock :: Word256 -> OutputBlock -> SequencerM Bool
runBlock chainId ob = do
  blocks <- runConduit
    ( yield (OEBlock ob)
   .| hydrateAndEmit (Just chainId)
   .| sinkList
    )
  mapM_ markForVM blocks
  return . not $ null blocks

runBlocks :: Word256 -> SequencerM ()
runBlocks chainId = do
  btr <- maybe S.empty _blocksToRun <$> getChainIdEntry chainId
  unless (S.null btr) $ do
    let b = S.elemAt 0 btr
    mBlock <- fmap _outputBlock <$> getBlockHashEntry (_bhash b)
    for_ mBlock $ \block -> do
      success <- runBlock chainId block
      when success $ do
        modifyChainIdEntryState_ chainId $ blocksToRun %= S.delete b
        runBlocks chainId

expandBlock :: ConduitM SequencedBlock (Either SequencedBlock OutputBlock) SequencerM ()
expandBlock = awaitForever $ \sb -> do
  readiness <- lift $ enqueueIfParentNotEmitted sb
  case readiness of
    NotReadyToEmit -> do
      $logWarnS "expandBlock" . T.pack $ prettyBlock sb ++ " is not yet ready to emit."
      lift $ P.incCounter seqBlocksEnqueued
      yield $ Left sb
    (ReadyToEmit totalPastDifficulty) -> do
      -- TODO: buildEmissionChain needs to do all of this so that we don't emit blocks missing transactions prematurely
      (ldbOps, dryChain) <- lift . fmap unzip $ buildEmissionChain sb totalPastDifficulty
      lift . addLdbBatchOps . catMaybes $ ldbOps
      if dryChain /= []
        then do
          $logInfoS "expandBlock" . T.pack $ prettyBlock sb ++ " is ready to emit! Emitting it and chain of dependents."
          yieldMany $ map Right dryChain
        else do
          $logInfoS "expandBlock" . T.pack $ prettyBlock sb ++ " is ready to emit, but its emission chain is empty. It was likely already emitted."
          yield $ Left sb

dropLefts :: Monad m => ConduitM (Either a b) b m ()
dropLefts = awaitForever $ \case
  Right b -> yield b
  _ -> return ()

runConsensus :: ConduitM (Either SequencedBlock OutputBlock) OutputEvent SequencerM ()
runConsensus = awaitForever $ \eob -> do
  hasPBFT <- lift $ blockstanbulRunning
  if not hasPBFT
    then case eob of
      Left _ -> return ()
      Right ob -> do
        let oeBlock = OEBlock ob
        lift $ markForP2P oeBlock
        yield oeBlock
    else do
      let convert :: BDB.Block -> InEvent
          convert blk = if isHistoricBlock blk
                          then PreviousBlock blk
                          else UnannouncedBlock blk
          route (Left sb) = sequencedBlockToBlock sb
          route (Right ob) = outputBlockToBlock ob
          -- Blockstanbul will check that the seals and validators match up before
          -- announcing it to the network or forwarding to the EVM.
      oes <- lift . blockstanbulSend' . convert $ route eob
      yieldMany oes

hydrateAndEmit :: Maybe Word256 -> ConduitM OutputEvent OutputEvent SequencerM ()
hydrateAndEmit chainId = awaitForever $ \case
  OEBlock ob -> do
    when (isNothing chainId) . yield $ OEBlock ob
    ob' <- lift $ hydratePrivateHashes ob chainId
    for_ ob' $ yield . OEBlock
  oe -> yield oe

accumT :: Monad m => s -> [a] -> (s -> a -> m (b,s)) -> m ([b],s)
accumT s [] _ = pure ([],s)
accumT s (a:as) run = do
  (b,s') <- run s a
  (bs,s'') <- accumT s' as run
  return (b:bs,s'')

-- using this explicit state monad because SequencerM is already MonadState
hydratePrivateHashes :: OutputBlock
                     -> Maybe Word256
                     -> SequencerM (Maybe OutputBlock)
hydratePrivateHashes ob chainF = do
  let logF = logFF "hydratePrivateHashes"
      bHash = blockHeaderHash $ obBlockData ob
  logF $ prettyOBlock ob
  repsertBlockHashEntry_ bHash $ return . fromMaybe (blockHashEntry ob)
  let discluded cId = maybe False (/= cId) chainF
  (txs', (depTXs,newDiscludes)) <- accumT ([],S.empty) (obReceiptTransactions ob) $ \st@(dts,cs) tx -> do
    if not $ isPrivateHashTX tx
      then return (Nothing, st)
      else do
        let TD.PrivateHashTX th' ch' = otBaseTx tx
            tHash = SHA th'
            cHash = SHA ch'
        runPrivateHashTX tHash cHash
        repsertTxHashEntry_ tHash $
          return . maybe
            (txHashEntryWithBlockHash bHash)
            (inBlock .~ Just bHash)
        repsertChainHashEntry_ cHash $
          return . maybe
            (chainHashEntryWithTxHashInBlock tHash bHash)
            ((inBlocks %~ (Q.|> bHash)) . (transactions %~ S.insert tHash))
        mChainId <- join . fmap _onChainId <$> getChainHashEntry cHash
        case mChainId of
          Nothing -> return (Nothing, st)
          Just chainId -> if discluded chainId || S.member chainId cs
            then do
              logF "This chain is discluded!"
              return (Nothing, st)
            else getChainIdEntry chainId >>= \case
              Nothing -> return (Nothing, st)
              Just ChainIdEntry{..} -> do
                let ready = if S.null _blocksToRun
                             then True
                             else (_bhash $ S.elemAt 0 _blocksToRun) == bHash
                if ready
                  then do
                    logF "Ready to run block on this chain"
                    body <- join . fmap _outputTx <$> getTxHashEntry tHash
                    case body of
                      Just otx -> do
                        logF $ "Transaction hash " ++ format tHash ++ " is not missing"
                        insertPrivateHash otx
                        return (Just otx, st)
                      Nothing -> do
                        logF . concat $
                          [ "Transaction hash "
                          , format tHash
                          , " is missing."
                          , " Inserting into TxBlockDB and DependentTxDB"
                          ]
                        modifyChainIdEntryState_ chainId $ do
                          when (isNothing chainF) $
                            blocksToRun %= S.insert (BlockInfo (obTotalDifficulty ob) bHash)
                        return (Nothing, (tHash:dts, S.insert chainId cs))
                  else do
                    logF "This is not the chain's next block to run."
                    modifyChainIdEntryState_ chainId $
                      when (isNothing chainF) $
                        blocksToRun %= S.insert (BlockInfo (obTotalDifficulty ob) bHash)
                    return (Nothing, (dts,S.insert chainId cs))

  -- we have to filter out lingering transactions that weren't initially discluded,
  -- but were discluded by a subsequent missing transcation
  let txs'' = filter (\otx -> not (discluded (fromJust $ txChainId otx)
                     || S.member (fromJust $ txChainId otx) newDiscludes)
                     ) $ catMaybes txs'

  unless (null depTXs) $ do
    logF . concat $
      [ "Block hash "
      , format bHash
      , " has dependent transactions.\n"
      , show (map format depTXs)
      , " Inserting them into GetTransactions list"
      ]
    mapM_ insertGetTransactionsDB depTXs
  if null txs''
    then return Nothing
    else do
      P.incCounter seqBlocksReleased
      return . Just $ ob{obReceiptTransactions = txs''}

transformBlocks :: [IngestBlock] -> SequencerM ()
transformBlocks = mapM_ $ \ib -> do
  let mSb = ingestBlockToSequencedBlock ib
  case mSb of
    Nothing -> do
      $logWarnS "transformEvents/emitBlocks" . T.pack
        $ "Could not ECRecover the pubkey of certain Txs in Block " ++ prettyIBlock ib ++ "; not emitting"
      P.incCounter seqBlocksEcrfail -- couldnt ecrecover some transactions in this block. block is likely garbage
    Just sb -> do
      witnessBlockHash (sbHash sb) sb -- TODO: this is for PoW, but we should figure out how to move it into `runConsensus`
      runBlockWithConsensus sb

transformGenesis :: [IngestGenesis] -> SequencerM ()
transformGenesis chains = forM_ chains $ \ig -> do
  let logF = logFF "transformGenesis"
  let og = ingestGenesisToOutputGenesis ig
      (chainId, cInfo) = ogGenesisInfo og
  markForP2P (OEGenesis og)
  logF $ "Transforming ChainInfo for chain " ++ format (SHA chainId) ++ " with info " ++ show cInfo
  lookupSeenChain chainId >>= \case
    True -> logF "We've seen this chain before. Not emitting to VM"
    False -> do
      logF "We haven't seen this chain before. Inserting into SeenChainDB and emitting to VM"
      cHash <- generateInitialChainHash cInfo
      insertSeenChain chainId cInfo
      insertChainHash cHash chainId
      insertChainBufferEntry chainId cHash
      markForVM $ OEGenesis og
      findChainHashUses chainId [cHash]
      runBlocks chainId

isPrivateHashTX :: TransactionLike t => t -> Bool
isPrivateHashTX = (== PrivateHash) . txType

isPrivateChainTX :: TransactionLike t => t -> Bool
isPrivateChainTX = isJust . txChainId

splitEvents :: [IngestEvent] -> SequencerM ()
splitEvents es = forM_ (partitionWith iEventType es) $ \(eventType, events) ->
  case eventType of
    IETTransaction -> do
      liftIO $ withLabel eventsplitMetrics "inevent_type_transaction" (flip unsafeAddCounter . fromIntegral . length $ es)
      $logInfoS "splitEvents" . T.pack $ "Running " ++ show (length events) ++ " IngestTransactions"
      transformTransactions $ map (\(IETx ts tx) -> (ts,tx)) events
    IETBlock -> do
      liftIO $ withLabel eventsplitMetrics "inevent_type_block" (flip unsafeAddCounter . fromIntegral . length $ es)
      $logInfoS "splitEvents" . T.pack $ "Running " ++ show (length events) ++ " IngestBlocks"
      transformBlocks $ map (\(IEBlock ob) -> ob) events
    IETGenesis -> do
      liftIO $ withLabel eventsplitMetrics "inevent_type_genesis" (flip unsafeAddCounter . fromIntegral . length $ es)
      $logInfoS "splitEvents" . T.pack $ "Running " ++ show (length events) ++ " IngestGenesises"
      transformGenesis $ map (\(IEGenesis og) -> og) events
    IETBlockstanbul -> do
      liftIO $ withLabel eventsplitMetrics "inevent_type_blockstanbul" (flip unsafeAddCounter . fromIntegral . length $ es)
      $logInfoS "splitevents" . T.pack $ "Running " ++ show (length events) ++ " IngestBlockstanbuls"
      blockstanbulSend $ map (\(IEBlockstanbul (WireMessage a m)) -> IMsg a m) events

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
      where prefix TD.MessageTX{}          = "MessageTx [" ++ (format . TX.partialTransactionHash $ t) ++ "]"
            prefix TD.ContractCreationTX{} = "CreationTx[" ++ (format . TX.partialTransactionHash $ t) ++ "]"
            prefix TD.PrivateHashTX{}    = "PrivateHashTx[" ++ (format . TX.partialTransactionHash $ t) ++ "]"

            shortOrigin (TO.PeerString peer) = "Peer " ++ take 8 peer
            shortOrigin x                    = format x

prettyOTx :: OutputTx -> String
prettyOTx OutputTx{otOrigin=o, otBaseTx=t} = prefix t ++ " via " ++ shortOrigin o
      where prefix TD.MessageTX{}          = "MessageTx [" ++ (format . TX.partialTransactionHash $ t) ++ "]"
            prefix TD.ContractCreationTX{} = "CreationTx[" ++ (format . TX.partialTransactionHash $ t) ++ "]"
            prefix TD.PrivateHashTX{}    = "PrivateHashTx[" ++ (format . TX.partialTransactionHash $ t) ++ "]"

            shortOrigin (TO.PeerString peer) = "Peer " ++ take 8 peer
            shortOrigin x                    = format x

writeSeqVmEvents :: [OutputEvent] -> SequencerM ()
writeSeqVmEvents events = do
    ch <- asks (seqVMEvents . cablePackage)
    atomically . mapM_ (writeTQueue ch) $ events

writeSeqP2pEvents :: [OutputEvent] -> SequencerM ()
writeSeqP2pEvents events = do
    ch <- asks (seqP2PEvents . cablePackage)
    atomically . mapM_ (writeTQueue ch) $ events
