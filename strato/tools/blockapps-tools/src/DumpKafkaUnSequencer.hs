{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}

module DumpKafkaUnSequencer where

import           Control.Monad.IO.Class
import           Network.Kafka.Protocol

import           Blockchain.EthConf
import           Blockchain.Sequencer.Kafka

import           Text.Format

dumpKafkaUnSequencer::Offset->IO ()
dumpKafkaUnSequencer startingBlock = do
  ret <- runKafkaConfigured "queryStrato" $ doConsume' startingBlock
  case ret of
    Left e  -> error $ show e
    Right _ -> return ()
  where
    doConsume' offset = do
      unseqEvents <- readUnseqEvents offset
      liftIO . putStrLn . unlines $ format <$> unseqEvents
      doConsume' (offset + fromIntegral (length unseqEvents))
