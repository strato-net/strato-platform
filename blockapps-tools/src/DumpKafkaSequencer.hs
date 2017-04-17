{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}

module DumpKafkaSequencer where

import           Control.Monad.IO.Class
import           Network.Kafka.Protocol

import           Blockchain.EthConf
import           Blockchain.Format
import           Blockchain.Sequencer.Kafka
import           Blockchain.Stream.Raw      (setDefaultKafkaState)

dumpKafkaSequencer::Offset->IO ()
dumpKafkaSequencer startingBlock = do
  ret <- runKafkaConfigured "queryStrato" $ doConsume' startingBlock
  case ret of
    Left e  -> error $ show e
    Right _ -> return ()
  where
    doConsume' offset = do
      setDefaultKafkaState
      seqEvents <- readSeqEvents offset
      liftIO . putStrLn . unlines $ format <$> seqEvents
      doConsume' (offset + fromIntegral (length seqEvents))
