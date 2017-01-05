{-# LANGUAGE TemplateHaskell, OverloadedStrings, DataKinds #-}
module Blockchain.Sequencer where

import Control.Monad.Reader
import Control.Monad.Logger

import Data.Maybe (maybeToList)
import qualified Data.Text as T

import Blockchain.EthConf (runKafkaConfigured)
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

import Blockchain.Util (Microtime, getCurrentMicrotime)

sequencer :: SequencerM ()
sequencer = forever $ do
    startUnseqOffset <- getLastIngestedOffset
    logInfoN $ T.pack ("Fetching unseqevents with offset " ++ (show startUnseqOffset))
    inEvents <- readUnseqEvents'
    afterReadUnseqOffset <- getLastIngestedOffset
    logInfoN $ T.pack ("Next fetch at offset " ++ (show afterReadUnseqOffset) ++ " (fetched " ++ (show $ length inEvents) ++ " events)")
    events <- forM inEvents $ \inEv -> do
        (emittedLDBWrites, outEv) <- transformEvents [inEv]
        let pendingLDBWrites = concatMap maybeToList emittedLDBWrites
        logInfoN $ T.pack ("Have " ++ (show . length $ pendingLDBWrites) ++ " pending LDB writes and " ++ (show $ length outEv) ++ " output events")
        applyLDBBatchWrites pendingLDBWrites
        logInfoN $ T.pack ("Applied pending LDB writes")
        return outEv
    writeSeqEvents' $ concat events
    logInfoN $ T.pack ("Wrote SeqEvents")

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
          kludge t   = case (wrapIngestBlockTransaction hash t) of
              Just ot -> ot
              Nothing -> OutputTx { otOrigin = TO.BlockHash hash
                                  , otSigner = A.Address . fromIntegral $ 0
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
                                  IEBlock bk -> (emitBlocks bk) (ingestBlockToSequencedBlock bk)

          emitTxs inTs inTx = let wrappedTx = wrapTransaction inTx in
            case wrappedTx of
                Nothing -> do
                    logWarnN $ T.pack ("Cannot ECRecover " ++ (prettyTx inTx) ++"; not emitting")
                    return [] -- ignore transactions we cant ECrecover
                Just tx -> do
                    let witnessHash = witnessableHash tx
                    txWasWitnessed <- wasTransactionHashWitnessed witnessHash
                    if txWasWitnessed
                      then do
                        logDebugN $ T.pack ("Already witnessed " ++ (prettyTx inTx) ++ "; not emitting")
                        return [] -- dont queue for emission
                      else do
                        logDebugN $ T.pack ("Haven't witnessed " ++ (prettyTx inTx) ++ "; emitting")
                        witnessTransactionHash witnessHash
                        return [(Nothing, OETx inTs tx)]

          emitBlocks bk b' = case b' of
            Nothing -> do
                logWarnN $ T.pack ("Could not ECRecover the pubkey of certain Txs in Block " ++ (prettyBlock bk) ++ "; not emitting")
                return [] -- couldnt ecrecover some transactions in this block. block is likely garbage
            Just b  -> do
                readyToEmit <- enqueueIfParentNotEmitted b
                case readyToEmit of
                    (ReadyToEmit totalPastDifficulty) -> do
                        logInfoN $ T.pack ((prettyBlock bk) ++ " is ready to emit! Emitting it and chain of dependents.")
                        buildEmissionChain b totalPastDifficulty
                    NotReadyToEmit                    -> do
                        logWarnN $ T.pack ((prettyBlock bk) ++ " is not yet ready to emit.")
                        return []

          prettyBlock IngestBlock{ibOrigin=o,ibBlockData=bd,ibReceiptTransactions=txs} = "Block #" ++ blockNonce ++ "/" ++ blockHash ++ " (via " ++ (format o) ++ ", " ++ (show . length $ txs) ++ " txs)"
            where blockNonce = show . BDB.blockDataNumber $ bd
                  blockHash  = format . BDB.blockHeaderHash $ bd

          prettyTx IngestTx{itOrigin=o, itTransaction=t} = ((prefix t) ++ " via " ++ (format o))
                where prefix (TD.MessageTX _ _ _ _ _ _ _ _ _)        = "MessageTx [" ++ (format . TX.partialTransactionHash $ t) ++ "]"
                      prefix (TD.ContractCreationTX _ _ _ _ _ _ _ _) = "CreationTx[" ++ (format . TX.partialTransactionHash $ t) ++ "]"

assertTopicCreation' :: SequencerM ()
assertTopicCreation' = do
    useKafkaClientId <- getKafkaClientID
    _ <- liftIO $ runKafkaConfigured useKafkaClientId $ assertTopicCreation
    return ()

readUnseqEvents' :: SequencerM [IngestEvent]
readUnseqEvents' = do
    offset           <- getLastIngestedOffset
    useKafkaClientId <- getKafkaClientID
    events           <- liftIO $
        runKafkaConfigured useKafkaClientId $ readUnseqEvents offset

    case events of
        Left e    -> error . show $ e
        Right evs -> do
            setLastIngestedOffset $ offset + (fromIntegral . length $ evs)
            return evs

writeSeqEvents' :: [OutputEvent] -> SequencerM ()
writeSeqEvents' events = do
    useKafkaClientId <- getKafkaClientID
    results          <- liftIO $
        runKafkaConfigured useKafkaClientId $ writeSeqEvents events

    case results of
        Left e  -> error . show $ e
        Right _ -> return ()
