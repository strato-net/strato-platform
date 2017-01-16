{-# LANGUAGE OverloadedStrings, TemplateHaskell, FlexibleContexts, FlexibleInstances, TypeSynonymInstances, BangPatterns #-}

module Executable.EthereumVM (
  ethereumVM
  ) where

import Control.Monad
import Control.Monad.Logger
import Control.Monad.IO.Class
import Control.Monad.STM
import Data.IORef
import qualified Data.Text as T
import Network.Kafka
import Network.Kafka.Protocol
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

import Executable.EVMFlags

import qualified Blockchain.Bagger as Bagger

import Blockchain.Util (getCurrentMicrotime, secondsToMicrotime)

savedOffsetFilePath::String
savedOffsetFilePath = ".ethereumH/vmOffset"

ethereumVM::LoggingT IO ()
ethereumVM = do
  let makeLazyBlocks = lazyBlocks $ quarryConfig ethConf
  readStartingBlock <- liftIO $ getSavedOffset savedOffsetFilePath

  let startingBlock =
        case (flags_startingBlock, readStartingBlock) of
         (-1, Just x) -> x
         (-1, Nothing) -> 1
         (val, _) -> val
                     
  offsetIORef <- liftIO $ newTVarIO startingBlock

  _ <- liftIO $ forkIO $ syncValToFile savedOffsetFilePath startingBlock offsetIORef
  _ <- execContextM $ do
        Bagger.setCalculateIntrinsicGas calculateIntrinsicGas'
        firstBlock <- getFirstBlockFromSequencer
        let firstBlockSHA  = outputBlockHash firstBlock
            firstBlockHead = obBlockData firstBlock
            firstBlockTD   = obTotalDifficulty firstBlock
            fbTxsCnt       = fromIntegral $ length $ obReceiptTransactions firstBlock
            fbUncleCnt     = fromIntegral $ length $ obBlockUncles firstBlock
        putBSum firstBlockSHA (blockHeaderToBSum firstBlockHead firstBlockTD fbTxsCnt)
        Bagger.processNewBestBlock firstBlockSHA firstBlockHead -- bootstrap Bagger with genesis block
        lastOffsetOrError <- liftIO $ runKafkaConfigured "ethereum-vm" $
                             getLastOffset LatestTime 0 (lookupTopic "seqevents")

        let lastOffset =
              case lastOffsetOrError of
               Left e -> error $ show e
               Right val -> val

        logInfoN $ T.pack $ "lastOffset = " ++ show lastOffset
        let microtimeCutoff = secondsToMicrotime flags_mempoolLivenessCutoff
        forever $ do
            $logInfoS "evm/loop" "Getting Blocks/Txs"
            offset <- liftIO $ readTVarIO offsetIORef
            seqEvents <- getUnprocessedKafkaEvents offsetIORef

            !currentMicrotime <- liftIO getCurrentMicrotime
            $logInfoS "evm/loop" $ T.pack $ "currentMicrotime :: " ++ show currentMicrotime

            when (fromIntegral offset >= lastOffset) $ do
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
                newBlock <- Bagger.makeNewBlock
                produceUnminedBlocks [outputBlockToBlock newBlock]

            liftIO $ atomically $ writeTVar offsetIORef $ offset + fromIntegral (length seqEvents)

            return ()
  return ()

getSavedOffset::FilePath->IO (Maybe Integer)
getSavedOffset filePath = do
  fileExists <- doesFileExist filePath
  if fileExists
    then (Just . read) <$> readFile filePath
    else return Nothing
      
syncValToFile::(Read a, Show a, Eq a)=>FilePath->a->TVar a->IO ()
syncValToFile filePath oldVal tVar = do
  newVal <- readTVarIO tVar
  when (oldVal /= newVal) $ writeFile filePath $ show newVal
  threadDelay 1000000
  syncValToFile filePath newVal tVar
  

getFirstBlockFromSequencer :: (MonadLogger m, HasBlockSummaryDB m) => m OutputBlock
getFirstBlockFromSequencer = do
    dummyIORef      <- liftIO $ newTVarIO (0 :: Integer)
    (OEBlock block) <- head <$> getUnprocessedKafkaEvents dummyIORef
    return block

getUnprocessedKafkaEvents::(MonadIO m, MonadLogger m)=>
                           TVar Integer->m [OutputEvent]
getUnprocessedKafkaEvents offsetIORef = do
  offset <- liftIO $ readTVarIO offsetIORef
  $logInfoS "getUnprocessedKafkaEvents" . T.pack $ "Fetching sequenced blockchain events with offset " ++ show offset
  ret <-
      liftIO $ runKafkaConfigured "ethereum-vm" $ readSeqEvents $ Offset $ fromIntegral offset

  case ret of
    Left e -> error $ show e
    Right v -> do 
      $logInfoS "getUnprocessedKafkaEvents" . T.pack $ "Got: " ++ (show . length $ v) ++ " unprocessed blocks/txs"
      return v
