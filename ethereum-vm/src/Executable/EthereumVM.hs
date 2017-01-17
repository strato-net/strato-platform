{-# LANGUAGE OverloadedStrings, TemplateHaskell, BangPatterns, LambdaCase #-}

module Executable.EthereumVM (
  ethereumVM
) where

import Control.Monad
import Control.Monad.Logger
import Control.Monad.IO.Class
import Control.Monad.STM
import Data.IORef
import qualified Data.Text as T
import qualified Network.Kafka as K
import qualified Network.Kafka.Protocol as KP
import qualified Network.Kafka.Consumer as KC
import Control.Concurrent
import Control.Concurrent.STM.TVar
import System.Directory

import Blockchain.BlockChain
import Blockchain.Data.BlockSummary
import Blockchain.DB.BlockSummaryDB
import Blockchain.EthConf
import Blockchain.JsonRpcCommand
import Blockchain.KafkaTopics
import Blockchain.VMOptions
import Blockchain.VMContext
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.Stream.UnminedBlock (produceUnminedBlocks)
import Blockchain.Format (format)

import Executable.EVMFlags
import Executable.EVMCheckpoint

import qualified Blockchain.Bagger as Bagger

import Blockchain.Util (Microtime, getCurrentMicrotime, secondsToMicrotime)

ethereumVM :: LoggingT IO ()
ethereumVM = void . execContextM $ do
    let makeLazyBlocks = lazyBlocks $ quarryConfig ethConf
    Bagger.setCalculateIntrinsicGas calculateIntrinsicGas'
    (cpOffset, EVMCheckpoint cpHash cpHead) <- getCheckpoint
    Bagger.processNewBestBlock cpHash cpHead -- bootstrap Bagger with genesis block

    $logInfoS "evm/preLoop" $ T.pack $ "cpOffset = " ++ show cpOffset
    let microtimeCutoff = secondsToMicrotime flags_mempoolLivenessCutoff
    forever $ do
        (cpOffset, _) <- getCheckpoint
        $logInfoS "evm/loop" "Getting Blocks/Txs"
        seqEvents <- getUnprocessedKafkaEvents cpOffset

        !currentMicrotime <- liftIO getCurrentMicrotime
        $logInfoS "evm/loop" $ T.pack $ "currentMicrotime :: " ++ show currentMicrotime

        let newCommands = [c | OEJsonRpcCommand c <- seqEvents]
        forM_ newCommands runJsonRpcCommand

        let allNewTxs = [(ts, t) | OETx ts t <- seqEvents]
        forM_ allNewTxs $ \(ts, t) ->
            $logInfoS "evm/loop/allNewTxs" $ T.pack $ "math :: " ++ show currentMicrotime ++ " - " ++ show ts ++ " = " ++ show (currentMicrotime - ts) ++ "; <= " ++ show microtimeCutoff ++ "? " ++ show ((currentMicrotime - ts) <= microtimeCutoff)
        let poolableNewTxs = [t | (ts, t) <- allNewTxs, abs (currentMicrotime - ts) <= microtimeCutoff]
        $logInfoS "evm/loop" (T.pack ("adding " ++ show (length poolableNewTxs) ++ "/" ++ show (length allNewTxs) ++ " txs to mempool"))
        unless (null poolableNewTxs) $ Bagger.addTransactionsToMempool poolableNewTxs

        let blocks = [b | OEBlock b <- seqEvents]
        $logInfoS "evm/loop" $ T.pack $ "Running " ++ show (length blocks) ++ " blocks"
        forM_ blocks $ \b ->
            putBSum (outputBlockHash b) (blockHeaderToBSum (obBlockData b) (obTotalDifficulty b) (fromIntegral $ length $ obReceiptTransactions b))
        addBlocks False blocks

        when (not makeLazyBlocks || not (null poolableNewTxs)) $ do
            $logInfoS "evm/loop/newBlock" "calling Bagger.makeNewBlock"
            newBlock <- Bagger.makeNewBlock
            $logInfoS "evm/loop/newBlock" "calling produceUnminedBlocks"
            produceUnminedBlocks [outputBlockToBlock newBlock]

        let newOffset = cpOffset + fromIntegral (length seqEvents)
        checkpointData <- uncurry EVMCheckpoint <$> Bagger.getCheckpointableState
        setCheckpoint newOffset checkpointData

clientId :: K.KafkaClientId
clientId = "ethereum-vm"

consumerGroup :: KP.ConsumerGroup
consumerGroup = lookupConsumerGroup "ethereum-vm"

getFirstBlockFromSequencer :: (MonadIO m, MonadLogger m) => m OutputBlock
getFirstBlockFromSequencer = do
    (OEBlock block) <- head <$> getUnprocessedKafkaEvents (KP.Offset 0)
    return block

-- this one starts at 1, 0 is reserved for genesis block and is used to
-- bootstrap a ton of this
initializeCheckpoint :: (MonadIO m, MonadLogger m) => m ()
initializeCheckpoint = do
    block@OutputBlock{obBlockData=header} <- getFirstBlockFromSequencer
    let sha = outputBlockHash block
    setCheckpoint 1 (EVMCheckpoint sha header)

getCheckpoint :: (MonadIO m, MonadLogger m) => m (KP.Offset, EVMCheckpoint)
getCheckpoint = do
    let topic  = seqEventsTopicName
        topic' = show topic
        cg'    = show consumerGroup
    $logInfoS "getCheckpoint" . T.pack $ "Getting checkpoint for topic " ++ topic' ++ "#0 for CG " ++ cg'
    liftIO (runKafkaConfigured clientId (KC.fetchSingleOffset consumerGroup topic 0)) >>= \case
        Left err -> error $ "Error fetching checkpoint `" ++ topic' ++ "`: " ++ show err
        Right (Left KP.UnknownTopicOrPartition) -> initializeCheckpoint >> getCheckpoint
        Right (Left err) -> error $ "Unexpected response when fetching checkpoint: " ++ show err
        Right (Right (ofs, md)) -> return (ofs, fromKafkaMetadata md)


setCheckpoint :: (MonadIO m, MonadLogger m) => KP.Offset -> EVMCheckpoint -> m ()
setCheckpoint ofs checkpoint = do
    $logInfoS "setCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs ++ " / " ++ format checkpoint
    let kMetadata = toKafkaMetadata checkpoint
    time <- liftIO $ KP.Time . fromIntegral <$> getCurrentMicrotime
    ret  <- liftIO $ runKafkaConfigured clientId $
        KC.commitSingleOffset consumerGroup seqEventsTopicName 0 ofs time kMetadata
    case ret of
        Left e         -> error $ show e
        Right (Left e) -> error $ show e
        Right _ -> return ()

getUnprocessedKafkaEvents :: (MonadIO m, MonadLogger m) => KP.Offset -> m [OutputEvent]
getUnprocessedKafkaEvents offset = do
    $logInfoS "getUnprocessedKafkaEvents" . T.pack $ "Fetching sequenced blockchain events with offset " ++ show offset
    ret <- liftIO $ runKafkaConfigured clientId (readSeqEvents offset)
    case ret of
        Left e -> error $ show e
        Right v -> do
            $logInfoS "getUnprocessedKafkaEvents" . T.pack $ "Got: " ++ (show . length $ v) ++ " unprocessed blocks/txs"
            return v
