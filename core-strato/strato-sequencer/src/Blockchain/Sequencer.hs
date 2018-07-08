{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# OPTIONS -fno-warn-unused-local-binds #-}
{-# OPTIONS -fno-warn-unused-matches #-}
module Blockchain.Sequencer where

import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.State
import           Control.Monad.Stats                       hiding (prefix)
import           Control.Monad.IO.Class                    (liftIO)
import           System.Clock

import           Data.Foldable                             (toList)
import           Data.Function                             ((&))
import           Data.Maybe                                (catMaybes, fromMaybe, fromJust, isJust)
import qualified Data.Sequence                             as Q
import qualified Data.Set                                  as S
import qualified Data.Text                                 as T

import           Blockchain.Format
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
import           Blockchain.Sequencer.DB.SeenTransactionDB
import           Blockchain.Sequencer.DB.TxBlockDB
import           Blockchain.Sequencer.Event

import           Blockchain.Sequencer.Kafka
import           Blockchain.Sequencer.Metrics
import           Blockchain.Sequencer.Monad

import qualified Blockchain.Data.Address                   as A
import qualified Blockchain.Data.BlockDB                   as BDB
import qualified Blockchain.Data.Transaction               as TX
import qualified Blockchain.Data.TransactionDef            as TD
import qualified Blockchain.Data.TXOrigin                  as TO

import qualified Database.LevelDB                          as LDB

import qualified Blockchain.MilenaTools                    as K
import qualified Network.Kafka.Protocol                    as KP

import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA

import           Blockchain.Util

sequencer :: SequencerM ()
sequencer = forever $ do
    inEvents <- readUnseqEvents'
    $logInfoS "sequencer" . T.pack $ "Fetched " ++ show (length inEvents) ++ " events)"
    clearGetChainsDB
    clearGetTransactionsDB
    clearEvents
    t0 <- liftIO $ getTime Realtime
    pendingLDBWrites <- splitEvents $ map snd inEvents
    t1 <- liftIO $ getTime Realtime
    $logDebug . T.pack $ "transformEvents took: " ++ show (toNanoSecs $ t1 - t0)
    applyLDBBatchWrites (concat pendingLDBWrites)
    tick ctr_sequencer_ldb_batch_writes
    setGauge (length pendingLDBWrites) ctr_sequencer_ldb_batch_size
    $logInfoS "sequencer" "Applied pending LDB writes"
    vmEvs <- vmEvents <$> get
    unless (Q.length vmEvs == 0) $ do
      writeSeqVmEvents' $ toList vmEvs
      $logInfoS "sequencer" . T.pack $ "Wrote " ++ show vmEvs ++ " SeqEvents to VM"
    p2pEvs <- p2pEvents <$> get
    unless (Q.length p2pEvs == 0) $ do
      writeSeqP2pEvents' $ toList p2pEvs
      $logInfoS "sequencer" . T.pack $ "Wrote " ++ show p2pEvs ++ " SeqEvents to P2P"
    let ofs = maximum $ map fst inEvents
    setNextIngestedOffset ofs

-- bootstrap genesis block into leveldb if needed
bootstrap :: BDB.Block -> SequencerM OutputBlock
bootstrap BDB.Block{BDB.blockBlockData = bd, BDB.blockReceiptTransactions = txs, BDB.blockBlockUncles = us} = helper
    where shortCircuit = OutputBlock { obOrigin              = TO.Direct
                                     , obBlockData           = bd
                                     , obBlockUncles         = us
                                     , obTotalDifficulty     = difficulty
                                     , obReceiptTransactions = kludge <$> txs
                                     }
          hash       = BDB.blockHeaderHash bd
          difficulty = BDB.blockDataDifficulty bd
          kludge t   = fromMaybe fallback (wrapIngestBlockTransaction hash t)
              where fallback = OutputTx { otOrigin = TO.BlockHash hash
                                        , otSigner = A.Address 0
                                        , otBaseTx = t
                                        , otHash   = TX.transactionHash t
                                        }
          helper = do
              bootstrapGenesisBlock hash difficulty
              shouldEmit <- bootstrapDoEmit <$> ask
              when shouldEmit $ do
                  assertTopicCreation'
                  writeSeqVmEvents' [OEBlock shortCircuit]  -- todo handle the error :)
                  writeSeqP2pEvents' [OEBlock shortCircuit]  -- todo handle the error :)
              return shortCircuit

transformPrivateHashTXs :: [(Timestamp, IngestTx)] -> SequencerM ()
transformPrivateHashTXs pairs = forM_ pairs $ \(_, (IngestTx _ (TD.PrivateHashTX th' ch'))) -> do
  let th = SHA th'
      ch = SHA ch'
  lookupSeenTxHash th >>= \case
    Just _ -> return ()
    Nothing -> do
      insertSeenTxHash th ch
      lookupTransaction th >>= \case
        Just tx -> useChainHash ch (fromJust $ TD.transactionChainId tx)
        Nothing -> do
          lookupChainHash ch >>= \case
            Nothing -> return ()
            Just (_, cid) -> do
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
            tick ctr_sequencer_txs_witnessed
            return Nothing
          False -> do
            $logDebugS "transformEvents/emitTxs" . T.pack $ "Haven't witnessed " ++ prettyTx itx
            witnessTransactionHash witnessHash
            tick ctr_sequencer_txs_unwitnessed
            return $ Just (ts,otx)
  let otxs = catMaybes mOtxs
  forM_ (partitionWith (isPrivateChainTX . otBaseTx . snd) otxs) $ \(isPrivateChain, txs) -> do
    if not isPrivateChain
      then do
        mapM_ (markForVM . pairToOETx) txs
        mapM_ (markForP2P . pairToOETx) txs
      else forM_ (partitionWith (TD.transactionChainId . otBaseTx . snd) txs) $ \((Just chainId), ptxs) -> do
        lookupSeenChain chainId >>= \case
          False -> do
            insertMissingChainTxs chainId $ map (txHash . otBaseTx . snd) ptxs
            insertGetChainsDB chainId
          True -> forM_ ptxs $ \(ts, ptx) -> do
            (tHash, cHash) <- insertPrivateHash $ otBaseTx ptx
            insertSeenTxHash tHash cHash -- TODO: this should be part of insertPrivateHash
            removeMissingTx tHash -- TODO: this should also be part of insertPrivateHash
            lookupTxBlocks tHash >>= \case
              Nothing -> do -- if it's not already in a block, send it to the world
                let SHA th' = tHash
                    SHA ch' = cHash
                    phtx = ptx{otBaseTx = TD.PrivateHashTX th' ch'}
                markForVM $ pairToOETx (ts, phtx)
                markForP2P $ pairToOETx (ts, phtx)
              Just bHash -> lookupDependentTxs bHash >>= \case
                depTxs | not (S.member tHash depTxs) ->
                  error $ "lookupDependentTxs: transaction " ++ format tHash ++ " claims to depend on block " ++ format bHash ++ ", but it's missing from the block's dependent transaction set. Dependent transactions: " ++ (show . map format $ S.toList depTxs)
                depTxs | depTxs == S.singleton tHash -> do
                  removeTxBlock tHash
                  clearDependentTxs bHash
                  -- when (readyToEmit bHash) $ do -- FIXME: Should hydrate block and emit to VM
                  --   hydratedBlock <- hydrateBlock bHash
                  --   markForVM $ OEBlock hydratedBlock
                depTxs -> do
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

transformBlocks :: [IngestBlock] -> SequencerM [[LDB.BatchOp]]
transformBlocks blocks = forM blocks $ \ib -> do
  let mSb = ingestBlockToSequencedBlock ib
  case mSb of
    Nothing -> do
      $logWarnS "transformEvents/emitBlocks" . T.pack $ "Could not ECRecover the pubkey of certain Txs in Block " ++ prettyBlock ib ++ "; not emitting"
      tick ctr_sequencer_blocks_ecrfail
      return [] -- couldnt ecrecover some transactions in this block. block is likely garbage
    Just sb -> do
      t0 <- liftIO $ getTime Realtime
      readiness <- enqueueIfParentNotEmitted sb
      t1 <- liftIO $ getTime Realtime
      $logDebug . T.pack $ "enqueueIfParentNotEmitted took: " ++ show (toNanoSecs $ t1 - t0)
      case readiness of
          (ReadyToEmit totalPastDifficulty) -> do
              dryChain <- buildEmissionChain sb totalPastDifficulty -- TODO: buildEmissionChain needs to do all of this so that we don't emit blocks missing transactions prematurely
              if (dryChain /= [])
                then $logInfoS "transformEvents/emitBlocks" . T.pack $ prettyBlock ib ++ " is ready to emit! Emitting it and chain of dependents."
                else $logInfoS "transformEvents/emitBlocks" . T.pack $ prettyBlock ib ++ " is ready to emit, but its emission chain is empty. It was likely already emitted."
              mapM_ (markForP2P . OEBlock . snd) dryChain
              temp <- forM dryChain $ \(ldbOp, ob) -> do
                let bHash = blockHeaderHash $ obBlockData ob
                forM_ (obReceiptTransactions ob) $ \tx -> do
                  when (isPrivateHashTX tx) $ do
                    let TD.PrivateHashTX{TD.transactionTxHash = th'} = otBaseTx tx
                        th = SHA th'
                    lookupMissingTx th >>= \case
                      False -> return ()
                      True -> do
                        insertTxBlock th bHash
                        insertDependentTx bHash th
                lookupDependentTxs bHash >>= \case
                  s | s == S.empty -> do
                    hydratedBlock <- hydrateBlock ob
                    tickBy 1 ctr_sequencer_blocks_released
                    markForVM $ OEBlock ob
                    return ldbOp
                  s -> do
                    mapM_ insertGetTransactionsDB s
                    return Nothing
              return $ catMaybes temp
          NotReadyToEmit -> do
              $logWarnS "transformEvents/emitBlocks" . T.pack $ prettyBlock ib ++ " is not yet ready to emit."
              tick ctr_sequencer_blocks_enqueued
              return []

transformGenesis :: [IngestGenesis] -> SequencerM ()
transformGenesis chains = forM_ chains $ \ig -> do
  let og = ingestGenesisToOutputGenesis ig
      (cId, cInfo) = ogGenesisInfo og
  markForP2P (OEGenesis og)
  lookupSeenChain cId >>= \case
    True -> return ()
    False -> do
      insertSeenChain cId
      markForVM $ OEGenesis og
      lookupMissingChainTxs cId >>= \case
        [] -> return ()
        ths -> forM_ ths $ \th -> lookupTransaction th >>= \case
          Nothing -> error $ "lookupTransaction: we believe we've seen transaction " ++ format th ++ " on chain " ++ show cId ++ ", but we haven't. Other transactions on chain: " ++ show (map format ths)
          Just tx -> do
            (tHash, cHash) <- insertPrivateHash tx
            insertSeenTxHash tHash cHash
            removeMissingTx tHash
            --markForP2P $ OETx 0 (TD.PrivateHashTX tHash cHash) -- FIXME: Should include current timetamp
            lookupTxBlocks tHash >>= \case
              Nothing -> return ()
              Just bHash -> lookupDependentTxs bHash >>= \case
                depTxs | not (S.member tHash depTxs) ->
                  error $ "lookupDependentTxs: transaction " ++ format tHash ++ " claims to depend on block " ++ format bHash ++ ", but it's missing from the block's dependent transaction set. Dependent transactions: " ++ (show . map format $ S.toList depTxs)
                depTxs | depTxs == S.singleton tHash -> do
                  removeTxBlock tHash
                  clearDependentTxs bHash
                  -- when (readyToEmit bHash) $ do -- TODO: Add SHA to OutputBlock lookup table
                  --   hydratedBlock <- hydrateBlock bHash
                  --   markForVM hydratedBlock
                depTxs -> do
                  removeTxBlock tHash
                  let depTxs' = S.delete tHash depTxs
                  mapM_ insertMissingTx depTxs'
                  mapM_ insertGetTransactionsDB depTxs'
                  insertDependentTxs bHash depTxs'

clearEvents :: SequencerM ()
clearEvents = get >>= \st -> put st{vmEvents = Q.empty, p2pEvents = Q.empty}

pairToOETx :: (Timestamp, OutputTx) -> OutputEvent
pairToOETx = uncurry OETx

markForVM :: OutputEvent -> SequencerM ()
markForVM oe = get >>= \st -> put st{vmEvents = (vmEvents st) Q.|> oe}

markForP2P :: OutputEvent -> SequencerM ()
markForP2P oe = get >>= \st -> put st{p2pEvents = (p2pEvents st) Q.|> oe}

isPrivateHashTX :: TransactionLike t => t -> Bool
isPrivateHashTX = (== PrivateHash) . txType

isPrivateChainTX :: TransactionLike t => t -> Bool
isPrivateChainTX = isJust . txChainId

hydrateBlock :: OutputBlock -> SequencerM OutputBlock
hydrateBlock ob = do
  otxs' <- forM (obReceiptTransactions ob) $ \otx -> do
    case txType (otBaseTx otx) of
      PrivateHash -> do
        mOtx' <- lookupTransaction (SHA . TD.transactionTxHash $ otBaseTx otx)
        case mOtx' of
          Nothing -> return otx
          Just otx' -> return otx{otBaseTx = otx'}
      _ -> return otx
  return ob{obReceiptTransactions = otxs'}

splitEvents :: [IngestEvent] -> SequencerM [[LDB.BatchOp]]
splitEvents es = forM (partitionWith iEventType es) $ \(eventType, events) ->
  case eventType of
    IETTransaction -> do
      transformTransactions $ map (\(IETx ts tx) -> (ts,tx)) events
      return []
    IETBlock -> do
      blocks' <- transformBlocks $ map (\(IEBlock ob) -> ob) events
      return $ concat blocks'
    IETGenesis -> do
      transformGenesis $ map (\(IEGenesis og) -> og) events
      return []

prettyBlock :: IngestBlock -> String
prettyBlock IngestBlock{ibOrigin=o,ibBlockData=bd,ibReceiptTransactions=txs} = "Block #" ++ blockNonce ++ "/" ++ bHash ++ " (via " ++ format o ++ ", " ++ show (length txs) ++ " txs)"
  where blockNonce = show . BDB.blockDataNumber $ bd
        bHash  = format . BDB.blockHeaderHash $ bd

prettyTx :: IngestTx -> String
prettyTx IngestTx{itOrigin=o, itTransaction=t} = prefix t ++ " via " ++ shortOrigin o
      where prefix TD.MessageTX{}          = "MessageTx [" ++ (format . TX.partialTransactionHash $ t) ++ "]"
            prefix TD.ContractCreationTX{} = "CreationTx[" ++ (format . TX.partialTransactionHash $ t) ++ "]"
            prefix TD.PrivateHashTX{}    = "PrivateHashTx[" ++ (format . TX.partialTransactionHash $ t) ++ "]"

            shortOrigin (TO.PeerString peer) = "Peer " ++ take 8 peer
            shortOrigin x                    = format x

assertTopicCreation' :: SequencerM ()
assertTopicCreation' = void $ K.withKafkaViolently assertTopicCreation

readUnseqEvents' :: SequencerM [(KP.Offset, IngestEvent)]
readUnseqEvents' = do
    offset <- getNextIngestedOffset
    $logInfoS "readUnseqEvents'" . T.pack $ "Fetching unseqevents from " ++ show offset
    ret <- zip [(offset+1)..] <$> K.withKafkaViolently (readUnseqEvents offset) -- its really [(nextOffset, eventAtThisOffset)]
    tickBy (length ret) ctr_sequencer_kafka_unseq_reads
    return ret

writeSeqVmEvents' :: [OutputEvent] -> SequencerM ()
writeSeqVmEvents' events = void $ do
    void $ K.withKafkaViolently (writeSeqVmEvents events)
    tickBy (length events) ctr_sequencer_kafka_seq_writes

writeSeqP2pEvents' :: [OutputEvent] -> SequencerM ()
writeSeqP2pEvents' events = void $ do
    void $ K.withKafkaViolently (writeSeqP2pEvents events)
    tickBy (length events) ctr_sequencer_kafka_seq_writes

getNextIngestedOffset :: SequencerM KP.Offset
getNextIngestedOffset = do
  group  <- getKafkaConsumerGroup
  ret <- K.withKafkaViolently (K.fetchSingleOffset group unseqEventsTopicName 0) >>= \case
    Left KP.UnknownTopicOrPartition -> -- we've never committed an Offset
        setNextIngestedOffset 0 >> getNextIngestedOffset
    Left err -> error $ "Unexpected response when fetching offset for " ++ show unseqEventsTopicName ++ ": " ++ show err
    Right (ofs, _) -> return ofs
  tick ctr_sequencer_kafka_checkpoint_reads
  return ret

deflatePrivateTransaction :: Timestamp -> OutputTx -> SequencerM [OutputEvent]
deflatePrivateTransaction ts otx =
  let baseTx = otBaseTx otx
   in case TD.transactionChainId baseTx of
        Nothing -> return [OETx ts otx]
        Just cid -> do
          chainSeen <- lookupSeenChain cid
          if chainSeen
            then do
              (SHA th, SHA ch) <- insertPrivateHash baseTx
              $logInfoS "transformEvents/deflatePrivateTransaction" . T.pack $ "Got chainHash " ++ format (SHA ch) ++ " for txHash " ++ format (SHA th)
              return [OETx ts otx, OETx ts otx{otBaseTx = TD.PrivateHashTX th ch, otSigner = A.Address 0}]
            else do
              insertSeenChain cid
              insertMissingChainTx cid (otHash otx)
              return [OEGetChain cid]

inflatePrivateTransaction :: OutputTx -> SequencerM OutputTx
inflatePrivateTransaction otx =
   case txType otx of
        Message -> return otx
        ContractCreation -> return otx
        PrivateHash -> do
          let TD.PrivateHashTX tHash _ = otBaseTx otx
          mTx <- lookupTransaction (SHA tHash)
          case mTx of
            Just tx -> return otx{otBaseTx = tx, otSigner = maybe (A.Address (-1)) id $ TX.whoSignedThisTransaction tx}
            Nothing -> return otx -- TODO: Use chainHash to lookup chainId and retrieve from P2P

setNextIngestedOffset :: KP.Offset -> SequencerM ()
setNextIngestedOffset newOffset = do
    group  <- getKafkaConsumerGroup
    $logInfoS "setNextIngestedOffset" . T.pack $ "Setting checkpoint to " ++ show newOffset
    tick ctr_sequencer_kafka_checkpoint_writes
    op <- K.withKafkaViolently $ K.commitSingleOffset group unseqEventsTopicName 0 newOffset ""
    op & \case
        Left err ->
            error $ "Unexpected response when setting the offset to " ++ show newOffset ++ ": " ++ show err
        Right () -> return ()

