{-# LANGUAGE OverloadedStrings, FlexibleContexts #-}

module DumpKafkaUnSequencer where

import Control.Lens
import Control.Monad.IO.Class
import Network.Kafka
import Network.Kafka.Protocol

import Blockchain.Sequencer.Kafka
import Blockchain.Format
import Blockchain.EthConf

dumpKafkaUnSequencer::Offset->IO ()
dumpKafkaUnSequencer startingBlock = do
  ret <- runKafkaConfigured "queryStrato" $ doConsume' startingBlock
  case ret of
    Left e -> error $ show e
    Right _ -> return ()
  where
    doConsume' offset = do
      stateRequiredAcks .= -1
      stateWaitSize .= 1
      stateWaitTime .= 100000
      unseqEvents <- readUnseqEvents offset
                                     
      liftIO $ putStrLn $ unlines $ map format unseqEvents

      doConsume' (offset + fromIntegral (length unseqEvents))
