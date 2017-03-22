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
import Blockchain.Stream.UnminedBlock (produceUnminedBlocksM)
import Blockchain.Format (format)

import Executable.EVMFlags
import Executable.EVMCheckpoint

import qualified Blockchain.Bagger as Bagger
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import           Blockchain.Strato.RedisBlockDB.Models

import Blockchain.Util (Microtime, getCurrentMicrotime, secondsToMicrotime)

uncurry3 :: (a -> b -> c -> d) -> ((a, b, c) -> d)
uncurry3 f (a, b, c) = f a b c

ethereumVM :: LoggingT IO ()
ethereumVM = void . execContextM $ do
 
    $logInfoS "difficultyBomb" $ T.pack $ "Difficulty bomb is " ++ show flags_difficultyBomb -- remove me once we figure out how to print args at startup

    let makeLazyBlocks = lazyBlocks $ quarryConfig ethConf
    Bagger.setCalculateIntrinsicGas calculateIntrinsicGas'
    (cpOffset, EVMCheckpoint cpHash cpHead cpShas cpBBI) <- getCheckpoint
    putContextBestBlockInfo cpBBI
    Bagger.processNewBestBlock cpHash cpHead cpShas -- bootstrap Bagger with genesis block

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

        -- todo: perhaps we shouldnt even add TXs to the mempool, it might make for a VERY large checkpoint
        -- todo: which may fail
        isCaughtUp <- shouldProcessNewTransactions
        let shouldOutputBlocks = isCaughtUp && (not makeLazyBlocks || not (null poolableNewTxs))
        when shouldOutputBlocks $ do
            $logInfoS "evm/loop/newBlock" "calling Bagger.makeNewBlock"
            newBlock <- Bagger.makeNewBlock
            $logInfoS "evm/loop/newBlock" "calling produceUnminedBlocksM"
            K.withKafkaViolently (produceUnminedBlocksM [outputBlockToBlock newBlock])

        let newOffset = cpOffset + fromIntegral (length seqEvents)
        baggerData <- uncurry3 EVMCheckpoint <$> Bagger.getCheckpointableState
        checkpointData <- baggerData <$> getContextBestBlockInfo
        setCheckpoint newOffset checkpointData

clientId :: K.KafkaClientId
clientId = "ethereum-vm"

consumerGroup :: KP.ConsumerGroup
consumerGroup = lookupConsumerGroup "ethereum-vm"

getFirstBlockFromSequencer :: ContextM OutputBlock
getFirstBlockFromSequencer = do
    (OEBlock block) <- head <$> getUnprocessedKafkaEvents (KP.Offset 0)
    return block

-- this one starts at 1, 0 is reserved for genesis block and is used to
-- bootstrap a ton of this
-- Also seeds the BlockSummaryDatabase
initializeCheckpointAndBlockSummary :: ContextM ()
initializeCheckpointAndBlockSummary = do
    block <- getFirstBlockFromSequencer
    initBlockSummary block
    let sha  = outputBlockHash block
        head = obBlockData block
        txs  = obReceiptTransactions block
        td   = obTotalDifficulty block
        txHs = otHash <$> txs
        txL  = length txs
        uncL = length (obBlockUncles block)
        cbbi = ContextBestBlockInfo (sha, head, td, txL, uncL)
    setCheckpoint 1 (EVMCheckpoint sha head txHs cbbi)


initBlockSummary :: OutputBlock -> ContextM ()
initBlockSummary block =
    let sha   = outputBlockHash block
        head  = obBlockData block
        td    = obTotalDifficulty block
        txCnt = fromIntegral $ length (obReceiptTransactions block)
    in
        putBSum sha (blockHeaderToBSum head td txCnt)

getCheckpoint :: ContextM (KP.Offset, EVMCheckpoint)
getCheckpoint = do
    let topic  = seqEventsTopicName
        topic' = show topic
        cg'    = show consumerGroup
    $logInfoS "getCheckpoint" . T.pack $ "Getting checkpoint for " ++ topic' ++ "#0 for " ++ cg'
    K.withKafkaViolently (KC.fetchSingleOffset consumerGroup topic 0) >>= \case
        Left KP.UnknownTopicOrPartition -> initializeCheckpointAndBlockSummary >> getCheckpoint
        Left err -> error $ "Unexpected response when fetching checkpoint: " ++ show err
        Right (ofs, md) -> do
            let md' = fromKafkaMetadata md
            $logInfoS "getCheckpoint" . T.pack $ show ofs ++ " / " ++ format md'
            return (ofs, md')


setCheckpoint :: KP.Offset -> EVMCheckpoint -> ContextM ()
setCheckpoint ofs checkpoint = do
    $logInfoS "setCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs ++ " / " ++ format checkpoint
    let kMetadata = toKafkaMetadata checkpoint
    ret  <- K.withKafkaViolently $ KC.commitSingleOffset consumerGroup seqEventsTopicName 0 ofs kMetadata
    either (error . show) return ret

getUnprocessedKafkaEvents :: KP.Offset -> ContextM [OutputEvent]
getUnprocessedKafkaEvents offset = do
    $logInfoS "getUnprocessedKafkaEvents" . T.pack $ "Fetching sequenced blockchain events with offset " ++ show offset
    ret <- K.withKafkaViolently (readSeqEvents offset)
    $logInfoS "getUnprocessedKafkaEvents" . T.pack $ "Got: " ++ show (length ret) ++ " unprocessed blocks/txs"
    return ret

shouldProcessNewTransactions :: ContextM Bool -- todo: probably shouldn't do it by number, but tdiff.
shouldProcessNewTransactions =
    if flags_useSyncMode then do
        worldBestBlock <- RBDB.withRedisBlockDB RBDB.getWorldBestBlockInfo
        case worldBestBlock of
            Nothing -> do
                $logInfoS "shouldProcessNewTransactions" "got Nothing from worldBestBlockInfo, playing it safe and not mining Txs"
                return False -- we either had no peers or some other error, lets play it safe
            Just (RedisBestBlock worldBestSha _ _) -> do
                didRunBest <- hasBSum worldBestSha
                let msg = if didRunBest
                            then "don't have a block summary for worldBestSha " ++ format worldBestSha ++ ", not mining"
                            else "found blockSummary for worldBestSha " ++ format worldBestSha ++ ", will mine"
                $logInfoS "shouldProcessNewTransactions" (T.pack msg)
                return didRunBest  -- todo, verify TDiff etc.
    else do
        $logInfoS "shouldProcessNewTransactions" "flags_useSyncMode == false, will process all new TXs"
        return True
