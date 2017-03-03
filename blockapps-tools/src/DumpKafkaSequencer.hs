{-# LANGUAGE OverloadedStrings, FlexibleContexts #-}

module DumpKafkaSequencer where

import Control.Lens
import Control.Monad.IO.Class
import Network.Kafka
import Network.Kafka.Protocol

import Blockchain.Sequencer.Kafka
import Blockchain.Format
import Blockchain.EthConf

dumpKafkaSequencer::Offset->IO ()
dumpKafkaSequencer startingBlock = do
  ret <- runKafkaConfigured "queryStrato" $ doConsume' startingBlock
  case ret of
    Left e -> error $ show e
    Right _ -> return ()
  where
    doConsume' offset = do
      stateRequiredAcks .= -1
      stateWaitSize .= 1
      stateWaitTime .= 100000
      seqEvents <- readSeqEvents offset
                                     
      liftIO $ putStrLn $ unlines $ map format seqEvents

      doConsume' (offset + fromIntegral (length seqEvents))
