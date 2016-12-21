{-# LANGUAGE OverloadedStrings, TemplateHaskell, FlexibleContexts, FlexibleInstances, TypeSynonymInstances #-}

module Executable.EthereumVM (
  ethereumVM
  ) where

import Control.Monad
import Control.Monad.Logger
import Control.Monad.IO.Class
import Data.IORef
import qualified Data.Text as T

import Network.Kafka
import Network.Kafka.Protocol
                    
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

import qualified Blockchain.Bagger as Bagger

ethereumVM::LoggingT IO ()
ethereumVM = do
  let makeLazyBlocks = lazyBlocks $ quarryConfig ethConf
  offsetIORef <- liftIO $ newIORef flags_startingBlock
  _ <- execContextM $ do
        Bagger.setCalculateIntrinsicGas calculateIntrinsicGas'
        firstBlock <- getFirstBlockFromSequencer
        let firstBlockSHA  = outputBlockHash firstBlock
            firstBlockHead = obBlockData firstBlock
        putBSum firstBlockSHA (blockHeaderToBSum firstBlockHead)
        Bagger.processNewBestBlock firstBlockSHA firstBlockHead -- bootstrap Bagger with genesis block
        lastOffsetOrError <- liftIO $ runKafkaConfigured "ethreum-vm" $ 
                             getLastOffset LatestTime 0 (lookupTopic "seqevents")

        let lastOffset =
              case lastOffsetOrError of
               Left e -> error $ show e
               Right val -> val

        logInfoN $ T.pack $ "lastOffset = " ++ show lastOffset
        
        forever $ do
            logInfoN "Getting Blocks/Txs"
            offset <- liftIO $ readIORef offsetIORef
            seqEvents <- getUnprocessedKafkaEvents offsetIORef

            when (fromIntegral offset >= lastOffset) $ do
              let newCommands = [c | OEJsonRpcCommand c <- seqEvents]
              forM_ newCommands runJsonRpcCommand
            
            let newTXs = [t | OETx t <- seqEvents]
            unless (null newTXs) $ logInfoN (T.pack ("adding " ++ (show $ length newTXs) ++ " txs to mempool")) >> Bagger.addTransactionsToMempool newTXs

            let blocks = [b | OEBlock b <- seqEvents]
            forM_ blocks $ \b -> putBSum (outputBlockHash b) (blockHeaderToBSum $ obBlockData b)
            addBlocks False blocks

            when ((not makeLazyBlocks) || (not $ null newTXs)) $ do
                newBlock <- Bagger.makeNewBlock
                produceUnminedBlocks [(outputBlockToBlock newBlock)]

            return ()
  return ()

getFirstBlockFromSequencer :: (MonadLogger m, HasBlockSummaryDB m) => m OutputBlock
getFirstBlockFromSequencer = do
    dummyIORef      <- liftIO $ newIORef (0 :: Integer)
    (OEBlock block) <- head <$> getUnprocessedKafkaEvents dummyIORef
    return block

getUnprocessedKafkaEvents::(MonadIO m, MonadLogger m)=>
                           IORef Integer->m [OutputEvent]
getUnprocessedKafkaEvents offsetIORef = do
  offset <- liftIO $ readIORef offsetIORef
  logInfoN $ T.pack $ "Fetching sequenced blockchain events with offset " ++ (show offset)
  ret <-
      liftIO $ runKafkaConfigured "ethereum-vm" $ do
        seqEvents <- readSeqEvents $ Offset $ fromIntegral offset
        liftIO $ writeIORef offsetIORef $ offset + fromIntegral (length seqEvents)
   
        return seqEvents

  case ret of
    Left e -> error $ show e
    Right v -> do 
      logInfoN . T.pack $ "Got: " ++ (show . length $ v) ++ " unprocessed blocks/txs"
      return v
