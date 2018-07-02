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
import           Control.Monad.Stats                       hiding (prefix)
import           Control.Monad.IO.Class                    (liftIO)
import           System.Clock

import           Data.Function                             ((&))
import           Data.Maybe                                (catMaybes, fromMaybe, fromJust)
import qualified Data.Set                                  as S
import qualified Data.Text                                 as T

import           Blockchain.Format
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.SeenTransactionDB
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
    forM_ inEvents $ \(ofs, inEv) -> do
        t0 <- liftIO $ getTime Realtime
        (emittedLDBWrites, outEv) <- transformEvents [inEv]
        t1 <- liftIO $ getTime Realtime
        $logDebug . T.pack $ "transformEvents took: " ++ show (toNanoSecs $ t1 - t0)
        let pendingLDBWrites = catMaybes emittedLDBWrites
            lenOutEv         = length outEv
        $logInfoS "sequencer" . T.pack $ "Have " ++ show (length pendingLDBWrites) ++ " pending LDB writes and " ++ show lenOutEv ++ " output events"
        applyLDBBatchWrites pendingLDBWrites
        tick ctr_sequencer_ldb_batch_writes
        setGauge (length pendingLDBWrites) ctr_sequencer_ldb_batch_size
        $logInfoS "sequencer" "Applied pending LDB writes"
        unless (lenOutEv == 0) $ do
            writeSeqVmEvents' outEv
            writeSeqP2pEvents' outEv
            $logInfoS "sequencer" . T.pack $ "Wrote " ++ show lenOutEv ++ " SeqEvents"
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

transformEvents :: [IngestEvent] -> SequencerM ([Maybe LDB.BatchOp], [OutputEvent])
transformEvents input = unzip . join <$> forM input unboxAndTransform
    where goSplitYourself :: [IngestEvent] -> SequencerM ()
          goSplitYourself es = forM_ (partitionWith iEventType es) $ \(eventType, events) -> do
            case eventType of
              IETTransaction -> forM_ (partitionWith isPrivateHashTX events) $ \(isPrivateHash, txs) -> do
                case isPrivateHash of
                  True -> forM_ txs $ \(IETx _ (IngestTx _ TD.PrivateHashTX{TD.transactionTxHash = th', TD.transactionChainHash = ch'})) -> do
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
                                -- TODO: add to GetTransactions list
                  False -> do
                    forM_ txs $ \(IETx ts tx) -> do
                      let witnessHash = witnessableHash tx
                      wasTransactionHashWitnessed witnessHash >>= \case
                        True -> do
                          $logDebugS "transformEvents/emitTxs" . T.pack $ "Already witnessed " ++ prettyTx tx
                          tick ctr_sequencer_txs_witnessed
                          return ()
                        False -> do
                          $logDebugS "transformEvents/emitTxs" . T.pack $ "Haven't witnessed " ++ prettyTx tx
                          witnessTransactionHash witnessHash
                          tick ctr_sequencer_txs_unwitnessed
                    forM_ (partitionWith isPrivateChainTX txs) $ \(isPrivateChain, txs') -> do
                      case isPrivateChain of
                        False -> return () -- TODO: Mark for send to VM and P2P
                        True -> forM_ (partitionWith getChainIdFromIETx txs') $ \((Just chainId), ptxs) -> do
                          lookupSeenChain chainId >>= \case
                            False -> insertMissingChainTxs chainId $ map (\(IETx _ (IngestTx _ tx)) -> (txHash tx)) ptxs -- TODO: Add chainId to GetChains list
                            True -> forM_ ptxs $ \(IETx _ (IngestTx _ ptx)) -> do
                              (tHash, cHash) <- insertPrivateHash ptx
                              insertSeenTxHash tHash cHash -- TODO: this should be part of insertPrivateHash
                              removeMissingTx tHash -- TODO: this should also be part of insertPrivateHash
                              -- TODO: Mark for send to P2P
                              lookupTxBlocks tHash >>= \case
                                Nothing -> return ()
                                Just bHash -> lookupDependentTxs bHash >>= \case
                                  depTxs | not (S.member tHash depTxs) ->
                                    error $ "lookupDependentTxs: transaction " ++ format tHash ++ " claims to depend on block " ++ format bHash ++ ", but it's missing from the block's dependent transaction set. Dependent transactions: " ++ (show . map format $ S.toList depTxs)
                                  depTxs | depTxs == S.singleton tHash -> do
                                    removeTxBlock tHash
                                    clearDependentTxs bHash
                                    when (readyToEmit bHash) $ do
                                      hydratedBlock <- hydrateBlock bHash
                                      markForVM hydratedBlock
                                  depTxs -> do
                                    removeTxBlock tHash
                                    let depTxs' = S.delete tHash depTxs
                                    mapM_ insertMissingTx depTxs' -- TODO: add to GetTransactions list
                                    insertDependentTxs bHash depTxs'
              IETBlock -> forM_ events $ \(IEBlock ib@IngestBlock{..}) -> do
                let bHash = blockHeaderHash ibBlockData
                when (readyToEmit ib) $ markForP2P ib
                forM_ ibReceiptTransactions $ \tx -> do
                  when (isPrivateHashTX tx) $ do
                    let TD.PrivateHashTX{TD.transactionTxHash = th'} = tx
                        th = SHA th'
                    lookupMissingTx th >>= \case
                      False -> return ()
                      True -> do
                        insertTxBlock th bHash
                        insertDependentTx bHash th
                lookupDependentTxs bHash >>= \case
                  s | s == S.empty -> do
                    when (readyToEmit bHash) $ do
                      hydratedBlock <- hydrateBlock bHash
                      markForVM hydratedBlock
                  _ -> return () -- TODO: add to GetTransactions list
              IETGenesis -> forM_ events $ \(IEGenesis (ig@(IngestGenesis io (cId, cInfo)))) -> do
                markForP2P (cId, cInfo)
                lookupSeenChain cId >>= \case
                  True -> return ()
                  False -> do
                    insertSeenChain cId
                    markForVM (cId, cInfo)
                    lookupMissingChainTxs cId >>= \case
                      [] -> return ()
                      ths -> forM_ ths $ \th -> lookupTransaction th >>= \case
                        Nothing -> error $ "lookupTransaction: we believe we've seen transaction " ++ format th ++ " on chain " ++ show cId ++ ", but we haven't. Other transactions on chain: " ++ show (map format ths)
                        Just tx -> do
                          (tHash, cHash) <- insertPrivateHash tx
                          insertSeenTxHash tHash cHash -- TODO: this should be part of insertPrivateHash
                          removeMissingTx tHash -- TODO: this should also be part of insertPrivateHash
                          markForP2P (tHash, cHash)
                          lookupTxBlocks tHash >>= \case
                            Nothing -> return ()
                            Just bHash -> lookupDependentTxs bHash >>= \case
                              depTxs | not (S.member tHash depTxs) ->
                                error $ "lookupDependentTxs: transaction " ++ format tHash ++ " claims to depend on block " ++ format bHash ++ ", but it's missing from the block's dependent transaction set. Dependent transactions: " ++ (show . map format $ S.toList depTxs)
                              depTxs | depTxs == S.singleton tHash -> do
                                removeTxBlock tHash
                                clearDependentTxs bHash
                                when (readyToEmit bHash) $ do
                                  hydratedBlock <- hydrateBlock bHash
                                  markForVM hydratedBlock
                              depTxs -> do
                                removeTxBlock tHash
                                let depTxs' = S.delete tHash depTxs
                                mapM_ insertMissingTx depTxs' -- TODO: add to GetTransactions list
                                insertDependentTxs bHash depTxs'

          markForVM = const (return ())
          markForP2P = const (return ())
          isPrivateHashTX = const False
          isPrivateChainTX = const False
          readyToEmit = const False
          hydrateBlock = return
          getChainIdFromIETx (IETx _ tx) = TD.transactionChainId $ itTransaction tx
          getChainIdFromIETx _ = error "getChainIdFromIETx: Called on not a transaction"

          unboxAndTransform e = case e of
                                  IETx ts tx -> emitTxs ts tx
                                  IEBlock bk -> emitBlocks bk (ingestBlockToSequencedBlock bk)
                                  IEGenesis (g@(IngestGenesis _ (cId, cInfo))) -> do
                                    insertChainInfo cId cInfo
                                    return [(Nothing, OEGenesis $ ingestGenesisToOutputGenesis g)]

          emitTxs inTs inTx = wrap inTx >>= mapM (deflatePrivateTransaction inTs) >>= return . map toOutput . concat

          toOutput oEv = (Nothing, oEv)

          wrap itx = do
            let wrappedTx = wrapTransaction itx
             in case wrappedTx of
                Nothing -> do
                    $logWarnS "transformEvents/emitTxs" . T.pack $ "Cannot ECRecover " ++ prettyTx itx ++"; not emitting"
                    tick ctr_sequencer_txs_ecrfail
                    return [] -- ignore transactions we cant ECrecover
                Just tx -> do
                    let witnessHash = witnessableHash tx
                    txWasWitnessed <- wasTransactionHashWitnessed witnessHash
                    if txWasWitnessed
                      then do
                        $logDebugS "transformEvents/emitTxs" . T.pack $ "Already witnessed " ++ prettyTx itx
                        tick ctr_sequencer_txs_witnessed
                        return []
                      else do
                        $logDebugS "transformEvents/emitTxs" . T.pack $ "Haven't witnessed " ++ prettyTx itx
                        witnessTransactionHash witnessHash
                        tick ctr_sequencer_txs_unwitnessed
                        return [tx]

          emitBlocks bk b' = case b' of
            Nothing -> do
                $logWarnS "transformEvents/emitBlocks" . T.pack $ "Could not ECRecover the pubkey of certain Txs in Block " ++ prettyBlock bk ++ "; not emitting"
                tick ctr_sequencer_blocks_ecrfail
                return [] -- couldnt ecrecover some transactions in this block. block is likely garbage
            Just b  -> do
                t0 <- liftIO $ getTime Realtime
                readiness <- enqueueIfParentNotEmitted b
                t1 <- liftIO $ getTime Realtime
                $logDebug . T.pack $ "enqueueIfParentNotEmitted took: " ++ show (toNanoSecs $ t1 - t0)
                case readiness of
                    (ReadyToEmit totalPastDifficulty) -> do
                        t2 <- liftIO $ getTime Realtime
                        deflatedChain <- buildEmissionChain b totalPastDifficulty
                        inflatedChain <- forM deflatedChain $ \(ldbOp, OEBlock (ob@OutputBlock{obReceiptTransactions = txs})) -> do
                          inflatedTxs <- mapM inflatePrivateTransaction txs
                          return (ldbOp, OEBlock ob{obReceiptTransactions = inflatedTxs})
                        t3 <- liftIO $ getTime Realtime
                        $logDebug . T.pack $ "buildEmissionChain took: " ++ show (toNanoSecs $ t3 - t2)
                        tickBy (length inflatedChain) ctr_sequencer_blocks_released
                        if (inflatedChain /= [])
                          then $logInfoS "transformEvents/emitBlocks" . T.pack $ prettyBlock bk ++ " is ready to emit! Emitting it and chain of dependents."
                          else $logInfoS "transformEvents/emitBlocks" . T.pack $ prettyBlock bk ++ " is ready to emit, but its emission chain is empty. It was likely already emitted."
                        return inflatedChain
                    NotReadyToEmit                    -> do
                        $logWarnS "transformEvents/emitBlocks" . T.pack $ prettyBlock bk ++ " is not yet ready to emit."
                        tick ctr_sequencer_blocks_enqueued
                        return []

          prettyBlock IngestBlock{ibOrigin=o,ibBlockData=bd,ibReceiptTransactions=txs} = "Block #" ++ blockNonce ++ "/" ++ bHash ++ " (via " ++ format o ++ ", " ++ show (length txs) ++ " txs)"
            where blockNonce = show . BDB.blockDataNumber $ bd
                  bHash  = format . BDB.blockHeaderHash $ bd

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

