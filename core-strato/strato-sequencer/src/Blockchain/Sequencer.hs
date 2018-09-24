{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TupleSections     #-}
module Blockchain.Sequencer where

import           ClassyPrelude                             (atomically)
import           Conduit
import           Control.Concurrent                        hiding (yield)
import           Control.Concurrent.STM.TMChan
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.State
import           Control.Monad.IO.Class                    (liftIO)
import           System.Clock

import           Data.ByteString.Char8                     (pack)
import           Data.ByteString.Base16                    as B16
import           Data.Foldable                             (toList)
import           Data.Maybe                                (catMaybes, fromJust, isJust, mapMaybe)
import qualified Data.Set                                  as S
import qualified Data.Text                                 as T
import           Data.Time.Clock
import           Prometheus                                as P
import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.HTTPAdmin         as API
import           Blockchain.Format
import           Blockchain.Sequencer.CablePackage
import           Blockchain.Sequencer.DB.ChainHashDB
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.DB.DependentTxDB
import           Blockchain.Sequencer.DB.GetChainsDB
import           Blockchain.Sequencer.DB.GetTransactionsDB
import           Blockchain.Sequencer.DB.MissingChainDB
import           Blockchain.Sequencer.DB.MissingTxDB
import           Blockchain.Sequencer.DB.PrivateTxDB
import           Blockchain.Sequencer.DB.SeenChainDB
import           Blockchain.Sequencer.DB.SeenHashDB
import           Blockchain.Sequencer.DB.SeenBlockDB
import           Blockchain.Sequencer.DB.SeenTransactionDB
import           Blockchain.Sequencer.DB.TxBlockDB
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


sequencer :: SequencerM ()
sequencer = do
  $logInfoS "sequencer" "Sequencer startup"
  source <- fuseChannels
  bootstrapBlockstanbul
  $logInfoS "sequencer" "Sequencer initialized"
  go (newResumableSource source)
 where
  go :: ResumableSource SequencerM SeqLoopEvent -> SequencerM ()
  go src = timeAction seqLoopTiming body >>= go
   where body :: SequencerM (ResumableSource SequencerM SeqLoopEvent)
         body = do
          $logInfoS "sequencer" "top of seqloop"
          clearAll
          createWaitTimer
          -- TODO(tim): It would be nice to figure out a way to just take the
          -- first N events when they are available before the wait timeout
          (src', events) <- src $$++ takeWhileC (/= WaitTerminated) .| sinkList
          (src'', ()) <- src' $$++ dropC 1 -- Remove the wait termination
          $logDebugS "sequencer/events" . T.pack . show $ events
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
          return src''

clearAll :: SequencerM ()
clearAll = clearLdbBatchOps >> clearGetChainsDB >> clearGetTransactionsDB

checkForUnseq :: [IngestEvent] -> SequencerM ()
checkForUnseq inEvents = do
    withLabel "unseq" (unsafeAddCounter . fromIntegral . length $ inEvents) seqLoopEvents
    t0 <- liftIO $ getTime Realtime
    timeAction seqSplitEventsTiming $ splitEvents inEvents
    t1 <- liftIO $ getTime Realtime
    $logDebug . T.pack $ "transformEvents took: " ++ show (toNanoSecs $ t1 - t0)
    pendingLDBWrites <- gets _ldbBatchOps
    applyLDBBatchWrites $ toList pendingLDBWrites
    P.incCounter seqLdbBatchWrites
    P.setGauge (fromIntegral (length pendingLDBWrites)) seqLdbBatchSize
    $logInfoS "sequencer" "Applied pending LDB writes"
    chainIds <- gets _getChainsDB
    unless (S.null chainIds) $ do
      markForP2P . OEGetChain $ toList chainIds
    txHashes <- gets _getTransactionsDB
    unless (S.null txHashes) $ do
      markForP2P . OEGetTx $ toList txHashes

checkForTimeouts :: [RoundNumber] -> SequencerM ()
checkForTimeouts rns = do
  withLabel "timeout" (unsafeAddCounter . fromIntegral . length $ rns) seqLoopEvents
  blockstanbulSend . map Timeout $ rns

checkForVotes :: [CandidateReceived] -> SequencerM ()
checkForVotes crs = do
  withLabel "vote" (unsafeAddCounter . fromIntegral . length $ crs) seqLoopEvents
  blockstanbulSend . map translate $ crs
  where translate :: CandidateReceived -> InEvent
        translate br =
          let extsign = RL.rlpDecode
                      . RL.rlpDeserialize
                      . fst
                      . B16.decode $ pack (API.signature br)
              bauth = MsgAuth { sender = (API.sender br), signature = extsign}
          in NewBeneficiary bauth ((API.recipient br), (API.votingdir br),(API.nonce br))


bootstrapBlockstanbul :: SequencerM ()
bootstrapBlockstanbul = do
  writeSeqVmEvents [OECreateBlockCommand]
  createFirstTimer

blockstanbulSend :: [InEvent] -> SequencerM ()
blockstanbulSend msgs = do
    resp' <- sendAllMessages msgs
    let blocks = [b | ToCommit b <- resp']
    resp <- (resp'++) <$>
        if null blocks
            then return []
            -- TODO(tim): Block insertion can potentially fail, so there
            -- should be feedback here
            else sendAllMessages [CommitResult (Right ())]
    mapM_ createNewTimer [rn | ResetTimer rn <- resp]
    $logDebugS "seq/pbft/send" . T.pack $ "Pre-rewrite: " ++ show blocks
    let rewriteBlock = fmap OEBlock
                     . fmap (flip sequencedBlockToOutputBlock 1)
                     . ingestBlockToSequencedBlock
                     . blockToIngestBlock TO.Blockstanbul
        creates = [OECreateBlockCommand | MakeBlockCommand <- resp]
        vmevs = creates ++ mapMaybe rewriteBlock blocks
        p2pevs = [OEBlockstanbul (WireMessage a m) | OMsg a m <- resp]
    unless (null blocks) $ do
      let tLast = blockHeaderTimestamp . BDB.blockBlockData . head $ blocks
      dt <- asks blockstanbulBlockPeriod
      let tNext = addUTCTime dt tLast
      now <- liftIO getCurrentTime
      when (now < tNext) $
       liftIO . threadDelay . round $ 1e6 * diffUTCTime tNext now

    $logDebugS "seq/pbft/send_vm" . T.pack . show $ vmevs
    mapM_ markForVM vmevs
    $logDebugS "seq/pbft/send_p2p" . T.pack . show $ p2pevs
    mapM_ markForP2P p2pevs

transformPrivateHashTXs :: [(Timestamp, IngestTx)] -> SequencerM ()
transformPrivateHashTXs pairs = forM_ pairs $ \(_, (IngestTx _ (TD.PrivateHashTX th' ch'))) -> do
  $logInfoS "transformPrivateHashTXs" . T.pack $ "Transforming transaction " ++ format (SHA th') ++ " with chain hash " ++ format (SHA ch')
  let th = SHA th'
      ch = SHA ch'
  lookupSeenTxHash th >>= \case
    Just _ -> do
      $logInfoS "transformPrivateHashTXs" "Transaction hash seen before!"
      return ()
    Nothing -> do
      $logInfoS "transformPrivateHashTXs" "Transaction hash not seen before! Inserting it into SeenTxHashDB"
      insertSeenTxHash th ch
      lookupTransaction th >>= \case
        Just tx -> do
          $logInfoS "transformPrivateHashTXs" . T.pack $ "We have this transaction's body. It's: " ++ prettyOTx tx
          useChainHash ch (fromJust . TD.transactionChainId $ otBaseTx tx)
        Nothing -> do
          $logInfoS "transformPrivateHashTXs" "We don't have this transaction's body. Looking it up by chain hash"
          lookupChainHash ch >>= \case
            Nothing -> do
              $logInfoS "transformPrivateHashTXs" "We don't know this transaction's chain Id. Oh well..."
              return ()
            Just (_, cid) -> do
              $logInfoS "transformPrivateHashTXs" . T.pack $ "We know this transaction's chain Id. It's " ++ format (SHA cid) ++ ". Inserting into MissingTxDB and GetTransactions list"
              useChainHash ch cid
              insertMissingTx th
              insertGetTransactionsDB th

transformFullTransactions :: [(Timestamp, IngestTx)] -> SequencerM ()
transformFullTransactions pairs = do
  mOtxs <- forM pairs $ \(ts,itx) -> do
    case wrapTransaction itx of
      Nothing -> return Nothing
      Just otx -> do
        let witnessHash = witnessableHash otx
        wasTransactionHashWitnessed witnessHash >>= \case
          True -> do
            $logDebugS "transformEvents/emitTxs" . T.pack $ "Already witnessed " ++ prettyTx itx
            P.incCounter seqTxsWitnessed
            return Nothing
          False -> do
            $logDebugS "transformEvents/emitTxs" . T.pack $ "Haven't witnessed " ++ prettyTx itx
            witnessTransactionHash witnessHash
            P.incCounter seqTxsUnwitnessed
            return $ Just (ts,otx)
  let otxs = catMaybes mOtxs
  forM_ (partitionWith (isPrivateChainTX . otBaseTx . snd) otxs) $ \(isPrivateChain, txs) -> do
    if not isPrivateChain
      then do
        $logInfoS "transformFullTransactions" . T.pack $ "Sending " ++ show (length txs) ++ "public transactions to P2P and the VM"
        mapM_ (markForVM . pairToOETx) txs
        mapM_ (markForP2P . pairToOETx) txs
      else forM_ (partitionWith (TD.transactionChainId . otBaseTx . snd) txs) $ \((Just chainId), ptxs) -> do
        $logInfoS "transformFullTransactions" . T.pack $ "Transforming " ++ show (length txs) ++ "private transactions on chain " ++ format (SHA chainId)
        lookupSeenChain chainId >>= \case
          False -> do
            $logInfoS "transformFullTransactions" . T.pack $ "We haven't seen the details for chain " ++ format (SHA chainId) ++ ". Inserting all transactions into MissingChainTxDB and inserting the chain Id into the GetChains list"
            insertMissingChainTxs chainId $ map (txHash . otBaseTx . snd) ptxs
            insertGetChainsDB chainId
          True -> forM_ ptxs $ \(ts, ptx) -> do
            $logInfoS "transformFullTransactions" . T.pack $ "We know the details for chain " ++ format (SHA chainId) ++ ". Inserting " ++ prettyOTx ptx ++ "into PrivateHashDB"
            let tHash = txHash ptx
            cHash <- lookupSeenTxHash tHash >>= \case
              Just ch -> do
                $logInfoS "transformFullTransactions" . T.pack $ "We have this transaction's chain hash. It's: " ++ format ch
                return ch
              Nothing -> do
                (_, cHash) <- insertPrivateHash ptx
                insertSeenTxHash tHash cHash -- TODO: this should be part of insertPrivateHash
                $logInfoS "transformFullTransactions" . T.pack $ "Created chain hash " ++ format cHash ++ " for transaction " ++ format tHash
                removeMissingTx tHash -- TODO: this should also be part of insertPrivateHash
                return cHash
            markForP2P $ pairToOETx (ts, ptx)
            lookupTxBlocks tHash >>= \case
              Nothing -> do -- if it's not already in a block, send it to the world
                $logInfoS "transformFullTransactions" . T.pack $ "Transaction " ++ format tHash ++ " has not been put in a block. Sending it to P2P!"
                let SHA th' = tHash
                    SHA ch' = cHash
                    phtx = ptx{otBaseTx = TD.PrivateHashTX th' ch'}
                markForVM $ pairToOETx (ts, phtx)
                markForP2P $ pairToOETx (ts, phtx)
              Just bHash -> lookupDependentTxs bHash >>= \case
                depTxs | not (S.member tHash depTxs) ->
                  error $ "lookupDependentTxs: transaction " ++ format tHash ++ " claims to depend on block " ++ format bHash ++ ", but it's missing from the block's dependent transaction set. Dependent transactions: " ++ (show . map format $ S.toList depTxs)
                depTxs | depTxs == S.singleton tHash -> do
                  $logInfoS "transformFullTransactions" . T.pack $ "Transaction " ++ format tHash ++ " is the only dependent transaction in block " ++ format bHash
                  removeTxBlock tHash
                  clearDependentTxs bHash
                  mBlock <- witnessedBlock bHash
                  mapM_ hydrateAndEmit mBlock
                depTxs -> do
                  $logInfoS "transformFullTransactions" . T.pack $ "Transaction " ++ format tHash ++ " is a dependent transaction in block " ++ format bHash ++ ", but there are others. Inserting them into MissingTxDB and GetTransactions list"
                  removeTxBlock tHash
                  let depTxs' = S.delete tHash depTxs
                  mapM_ insertMissingTx depTxs'
                  mapM_ insertGetTransactionsDB depTxs'
                  insertDependentTxs bHash depTxs'

transformTransactions :: [(Timestamp, IngestTx)] -> SequencerM ()
transformTransactions events = forM_ (partitionWith (isPrivateHashTX . itTransaction . snd) events) $ \(isPrivateHash, pairs) ->
  if isPrivateHash
    then transformPrivateHashTXs pairs
    else transformFullTransactions pairs

hydrateAndEmit :: SequencedBlock -> SequencerM ()
hydrateAndEmit sb = do
  wetBlocks <- runConduit $ hydrateAndEmit' .| sinkList
  hasPBFT <- blockstanbulRunning
  if not hasPBFT
    then mapM_ (markForVM . OEBlock) $ wetBlocks
    else let convert :: BDB.Block -> InEvent
             convert blk = if isHistoricBlock blk
                             then PreviousBlock blk
                             else UnannouncedBlock blk
         -- Blockstanbul will check that the seals and validators match up before
         -- announcing it to the network or forwarding to the EVM.
         in blockstanbulSend . map convert $ if null wetBlocks
                                               then [sequencedBlockToBlock sb]
                                               else map outputBlockToBlock wetBlocks
 where
 hydrateAndEmit' :: Conduit () SequencerM OutputBlock
 hydrateAndEmit' = do
  t0 <- liftIO $ getTime Realtime
  readiness <- lift $ enqueueIfParentNotEmitted sb
  t1 <- liftIO $ getTime Realtime
  let logHydrate = $logInfoS "hydrateAndEmit" . T.pack
  $logDebug . T.pack $ "enqueueIfParentNotEmitted took: " ++ show (toNanoSecs $ t1 - t0)
  case readiness of
      NotReadyToEmit -> do
          $logWarnS "transformEvents/emitBlocks" . T.pack $ prettyBlock sb ++ " is not yet ready to emit."
          lift $ P.incCounter seqBlocksEnqueued
      (ReadyToEmit totalPastDifficulty) -> do
          -- TODO: buildEmissionChain needs to do all of this so that we don't emit blocks missing transactions prematurely
          dryChain <- lift $ buildEmissionChain sb totalPastDifficulty
          if (dryChain /= [])
            then $logInfoS "transformEvents/emitBlocks" . T.pack $ prettyBlock sb ++ " is ready to emit! Emitting it and chain of dependents."
            else $logInfoS "transformEvents/emitBlocks" . T.pack $ prettyBlock sb ++ " is ready to emit, but its emission chain is empty. It was likely already emitted."
          hasPBFT <- lift blockstanbulRunning
          unless hasPBFT $
            mapM_ (lift . markForP2P . OEBlock . snd) dryChain
          ldbOps <- forM dryChain $ \(ldbOp, ob) -> do
            let bHash = blockHeaderHash $ obBlockData ob
            logHydrate $ prettyOBlock ob
            forM_ (obReceiptTransactions ob) $ \tx -> do
              when (isPrivateHashTX tx) $ do
                let TD.PrivateHashTX{TD.transactionTxHash = th'} = otBaseTx tx
                    th = SHA th'
                logHydrate $ "Looking up transaction hash " ++ format th ++ " in MissingTxDB"
                missing <- lift . isMissingTX $ th
                if missing
                  then do
                    logHydrate $ "Transaction hash " ++ format th ++ " is missing. Inserting into TxBlockDB and DependentTxDB"
                    lift $ insertTxBlock th bHash
                    lift $ insertDependentTx bHash th
                  else do
                    logHydrate $ "Transaction hash " ++ format th ++ " is not missing"
            depTXS <- lift . lookupDependentTxs $ bHash
            if S.null depTXS
              then do
                logHydrate $ "Block hash " ++ format bHash ++ " has no dependent transactions. Hydrating and emitting to VM"
                hydratedBlock <- lift . hydrateBlock $ ob
                lift $ P.incCounter seqBlocksReleased
                yield hydratedBlock

                return ldbOp
              else do
                logHydrate $ "Block hash " ++ format bHash ++ " has dependent transactions. Inserting them into GetTransactions list"
                lift $ mapM_ insertGetTransactionsDB depTXS
                return Nothing

          lift . addLdbBatchOps . catMaybes $ ldbOps

transformBlocks :: [IngestBlock] -> SequencerM ()
transformBlocks = mapM_ $ \ib -> do
  let mSb = ingestBlockToSequencedBlock ib
  case mSb of
    Nothing -> do
      $logWarnS "transformEvents/emitBlocks" . T.pack
        $ "Could not ECRecover the pubkey of certain Txs in Block " ++ prettyIBlock ib ++ "; not emitting"
      P.incCounter seqBlocksEcrfail -- couldnt ecrecover some transactions in this block. block is likely garbage
    Just sb -> do
      witnessBlockHash (sbHash sb) sb
      hydrateAndEmit sb


transformGenesis :: [IngestGenesis] -> SequencerM ()
transformGenesis chains = forM_ chains $ \ig -> do
  let og = ingestGenesisToOutputGenesis ig
      (cId, cInfo) = ogGenesisInfo og
  markForP2P (OEGenesis og)
  $logInfoS "transformGenesis" . T.pack $ "Transforming ChainInfo for chain " ++ format (SHA cId) ++ " with info " ++ show cInfo
  lookupSeenChain cId >>= \case
    True -> do
      $logInfoS "transformGenesis" "We've seen this chain before. Not emitting to VM"
      return ()
    False -> do
      $logInfoS "transformGenesis" "We haven't seen this chain before. Inserting into SeenChainDB and emitting to VM"
      insertChainInfo cId cInfo
      insertSeenChain cId
      markForVM $ OEGenesis og
      lookupMissingChainTxs cId >>= \case
        [] -> return ()
        ths -> forM_ ths $ \th -> lookupTransaction th >>= \case
          Nothing -> error $ "lookupTransaction: we believe we've seen transaction " ++ format th ++ " on chain " ++ show cId ++ ", but we haven't. Other transactions on chain: " ++ show (map format ths)
          Just tx -> do
            $logInfoS "transformGenesis" . T.pack $ "Inserting transaction " ++ prettyOTx tx
            (tHash, cHash) <- insertPrivateHash tx
            insertSeenTxHash tHash cHash
            removeMissingTx tHash
            let SHA th' = tHash
                SHA ch' = cHash
            markForP2P $ OETx 0 tx{otBaseTx = TD.PrivateHashTX th' ch'}
            lookupTxBlocks tHash >>= \case
              Nothing -> return ()
              Just bHash -> lookupDependentTxs bHash >>= \case
                depTxs | not (S.member tHash depTxs) ->
                  error $ "lookupDependentTxs: transaction " ++ format tHash ++ " claims to depend on block " ++ format bHash ++ ", but it's missing from the block's dependent transaction set. Dependent transactions: " ++ (show . map format $ S.toList depTxs)
                depTxs | depTxs == S.singleton tHash -> do
                  $logInfoS "transformGenesis" . T.pack $ "Transaction " ++ format tHash ++ " is the only dependent transaction in block " ++ format bHash
                  removeTxBlock tHash
                  clearDependentTxs bHash
                  mBlock <- witnessedBlock bHash
                  mapM_ hydrateAndEmit mBlock
                depTxs -> do
                  $logInfoS "transformGenesis" . T.pack $ "Transaction " ++ format tHash ++ " is a dependent transaction in block " ++ format bHash ++ ", but there are others. Inserting them into MissingTxDB and GetTransactions list"
                  removeTxBlock tHash
                  let depTxs' = S.delete tHash depTxs
                  mapM_ insertMissingTx depTxs'
                  mapM_ insertGetTransactionsDB depTxs'
                  insertDependentTxs bHash depTxs'

isPrivateHashTX :: TransactionLike t => t -> Bool
isPrivateHashTX = (== PrivateHash) . txType

isPrivateChainTX :: TransactionLike t => t -> Bool
isPrivateChainTX = isJust . txChainId

hydrateBlock :: OutputBlock -> SequencerM OutputBlock
hydrateBlock ob = do
  otxs' <- forM (obReceiptTransactions ob) $ \otx -> do
    case txType (otBaseTx otx) of
      PrivateHash -> do
        let sha = SHA . TD.transactionTxHash $ otBaseTx otx
        $logInfoS "hydrateBlock" . T.pack $ "Looking up transaction hash " ++ format sha
        mOtx' <- lookupTransaction sha
        case mOtx' of
          Nothing -> do
            $logInfoS "hydrateBlock" . T.pack $ "Transaction hash " ++ format sha ++ " not found."
            return otx
          Just otx' -> do
            $logInfoS "hydrateBlock" . T.pack $ "Transaction hash " ++ format sha ++ " found: " ++ prettyOTx otx'
            return otx'
      _ -> return otx
  return ob{obReceiptTransactions = otxs'}

splitEvents :: [IngestEvent] -> SequencerM ()
splitEvents es = forM_ (partitionWith iEventType es) $ \(eventType, events) ->
  case eventType of
    IETTransaction -> do
      $logInfoS "splitEvents" . T.pack $ "Running " ++ show (length events) ++ " IngestTransactions"
      transformTransactions $ map (\(IETx ts tx) -> (ts,tx)) events
    IETBlock -> do
      $logInfoS "splitEvents" . T.pack $ "Running " ++ show (length events) ++ " IngestBlocks"
      transformBlocks $ map (\(IEBlock ob) -> ob) events
    IETGenesis -> do
      $logInfoS "splitEvents" . T.pack $ "Running " ++ show (length events) ++ " IngestGenesises"
      transformGenesis $ map (\(IEGenesis og) -> og) events
    IETBlockstanbul -> do
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
    atomically . mapM_ (writeTMChan ch) $ events

writeSeqP2pEvents :: [OutputEvent] -> SequencerM ()
writeSeqP2pEvents events = do
    ch <- asks (seqP2PEvents . cablePackage)
    atomically . mapM_ (writeTMChan ch) $ events
