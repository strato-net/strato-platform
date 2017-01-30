{-# LANGUAGE TemplateHaskell, OverloadedStrings, DataKinds, LambdaCase #-}
module Blockchain.Sequencer where

import Control.Monad.Reader
import Control.Monad.Logger

import Data.Maybe (catMaybes, fromMaybe)
import Data.Function ((&))
import qualified Data.Text as T

import Blockchain.Format
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.DB.DependentBlockDB
import Blockchain.Sequencer.DB.SeenTransactionDB

import Blockchain.Sequencer.Kafka
import Blockchain.Sequencer.Monad

import qualified Blockchain.Data.Address        as A
import qualified Blockchain.Data.BlockDB        as BDB
import qualified Blockchain.Data.Transaction    as TX
import qualified Blockchain.Data.TransactionDef as TD
import qualified Blockchain.Data.TXOrigin       as TO

import qualified Database.LevelDB as LDB

import qualified Network.Kafka          as K
import qualified Network.Kafka.Protocol as KP
import qualified Network.Kafka.Consumer as KC

sequencer :: SequencerM ()
sequencer = forever $ do
    inEvents <- readUnseqEvents'
    $logInfoS "sequencer" . T.pack $ "Fetched " ++ show (length inEvents) ++ " events)"
    forM_ inEvents $ \(ofs, inEv) -> do
        (emittedLDBWrites, outEv) <- transformEvents [inEv]
        let pendingLDBWrites = catMaybes emittedLDBWrites
            lenOutEv         = length outEv
        $logInfoS "sequencer" . T.pack $ "Have " ++ show (length pendingLDBWrites) ++ " pending LDB writes and " ++ show lenOutEv ++ " output events"
        applyLDBBatchWrites pendingLDBWrites
        $logInfoS "sequencer" "Applied pending LDB writes"
        unless (lenOutEv == 0) $ do
            writeSeqEvents' outEv
            $logInfoS "sequencer" . T.pack $ "Wrote " ++ show lenOutEv ++ " SeqEvents"
        setNextIngestedOffset ofs

-- bootstrap genesis block into leveldb if needed
bootstrap :: BDB.Block -> SequencerM ()
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
                writeSeqEvents' [OEBlock shortCircuit]

transformEvents :: [IngestEvent] -> SequencerM ([Maybe LDB.BatchOp], [OutputEvent])
transformEvents input = unzip . join <$> forM input unboxAndTransform
    where unboxAndTransform e = case e of
                                  IETx ts tx -> emitTxs ts tx
                                  IEBlock bk -> emitBlocks bk (ingestBlockToSequencedBlock bk)

          emitTxs inTs inTx = let wrappedTx = wrapTransaction inTx in
            case wrappedTx of
                Nothing -> do
                    $logWarnS "transformEvents/emitTxs" . T.pack $ "Cannot ECRecover " ++ prettyTx inTx ++"; not emitting"
                    return [] -- ignore transactions we cant ECrecover
                Just tx -> do
                    let witnessHash = witnessableHash tx
                    txWasWitnessed <- wasTransactionHashWitnessed witnessHash
                    if txWasWitnessed
                      then do
                        $logDebugS "transformEvents/emitTxs" . T.pack $ "Already witnessed " ++ prettyTx inTx ++ "; not emitting"
                        return [] -- dont queue for emission
                      else do
                        $logDebugS "transformEvents/emitTxs" . T.pack $ "Haven't witnessed " ++ prettyTx inTx ++ "; emitting"
                        witnessTransactionHash witnessHash
                        return [(Nothing, OETx inTs tx)]

          emitBlocks bk b' = case b' of
            Nothing -> do
                $logWarnS "transformEvents/emitBlocks" . T.pack $ "Could not ECRecover the pubkey of certain Txs in Block " ++ prettyBlock bk ++ "; not emitting"
                return [] -- couldnt ecrecover some transactions in this block. block is likely garbage
            Just b  -> do
                readyToEmit <- enqueueIfParentNotEmitted b
                case readyToEmit of
                    (ReadyToEmit totalPastDifficulty) -> do
                        $logInfoS "transformEvents/emitBlocks" . T.pack $ prettyBlock bk ++ " is ready to emit! Emitting it and chain of dependents."
                        buildEmissionChain b totalPastDifficulty
                    NotReadyToEmit                    -> do
                        $logWarnS "transformEvents/emitBlocks" . T.pack $ prettyBlock bk ++ " is not yet ready to emit."
                        return []

          prettyBlock IngestBlock{ibOrigin=o,ibBlockData=bd,ibReceiptTransactions=txs} = "Block #" ++ blockNonce ++ "/" ++ blockHash ++ " (via " ++ format o ++ ", " ++ show (length txs) ++ " txs)"
            where blockNonce = show . BDB.blockDataNumber $ bd
                  blockHash  = format . BDB.blockHeaderHash $ bd

          prettyTx IngestTx{itOrigin=o, itTransaction=t} = prefix t ++ " via " ++ format o
                where prefix TD.MessageTX{}          = "MessageTx [" ++ (format . TX.partialTransactionHash $ t) ++ "]"
                      prefix TD.ContractCreationTX{} = "CreationTx[" ++ (format . TX.partialTransactionHash $ t) ++ "]"

assertTopicCreation' :: SequencerM ()
assertTopicCreation' = void $ K.withKafkaViolently assertTopicCreation

readUnseqEvents' :: SequencerM [(KP.Offset, IngestEvent)]
readUnseqEvents' = do
    offset <- getNextIngestedOffset
    $logInfoS "readUnseqEvents'" . T.pack $ "Fetching unseqevents from " ++ show offset
    zip [(offset+1)..] <$> K.withKafkaViolently (readUnseqEvents offset) -- its really [(nextOffset, eventAtThisOffset)]

writeSeqEvents' :: [OutputEvent] -> SequencerM ()
writeSeqEvents' events = void $ K.withKafkaViolently (writeSeqEvents events)

getNextIngestedOffset :: SequencerM KP.Offset
getNextIngestedOffset = do
  group  <- getKafkaConsumerGroup
  K.withKafkaViolently (KC.fetchSingleOffset group unseqEventsTopicName 0) >>= \case
    Left KP.UnknownTopicOrPartition -> -- we've never committed an Offset
        setNextIngestedOffset 0 >> getNextIngestedOffset
    Left err -> error $ "Unexpected response when fetching offset for " ++ show unseqEventsTopicName ++ ": " ++ show err
    Right (ofs, _) -> return ofs

setNextIngestedOffset :: KP.Offset -> SequencerM ()
setNextIngestedOffset newOffset = do
    group  <- getKafkaConsumerGroup
    $logInfoS "setNextIngestedOffset" . T.pack $ "Setting checkpoint to " ++ show newOffset
    op <- K.withKafkaViolently $ KC.commitSingleOffset group unseqEventsTopicName 0 newOffset ""
    op & \case
        Left err ->
            error $ "Unexpected response when setting the offset to " ++ show newOffset ++ ": " ++ show err
        Right () -> return ()

