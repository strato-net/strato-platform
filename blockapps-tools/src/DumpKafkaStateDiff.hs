{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}

module DumpKafkaStateDiff where

import           Control.Monad          (void)
import           Control.Monad.IO.Class
import qualified Data.ByteString.Char8  as BC


import           Network.Kafka
import           Network.Kafka.Protocol

import           Blockchain.EthConf
import           Blockchain.KafkaTopics
import           Blockchain.Stream.Raw

dumpKafkaStateDiff :: Offset -> IO ()
dumpKafkaStateDiff = void . runKafkaConfigured "queryStrato" . doConsume'
  where
    topic = lookupTopic "statediff"
    doConsume' offset = do
            lastOffset <- getLastOffset LatestTime 0 topic
            if lastOffset < offset then error "offset out of range" else doConsume'' offset
    doConsume'' offset = do
      result <- fetchBytes topic offset
      liftIO . putStrLn . unlines $ BC.unpack <$> result
      doConsume' (offset + fromIntegral (length result))
