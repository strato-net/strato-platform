{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
module DumpKafkaRaw where

import           Control.Monad          (void)
import           Control.Monad.IO.Class
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8  as BC

import           Network.Kafka
import           Network.Kafka.Protocol hiding (Message)

import           Blockchain.EthConf
import           Blockchain.KafkaTopics
import           Blockchain.Stream.Raw

dumpKafkaRaw :: String -> Offset -> IO ()
dumpKafkaRaw streamName = void . runKafkaConfigured "queryStrato" . doConsume'
  where
    topic = lookupTopic streamName
    doConsume' offset = do
        lastOffset <- getLastOffset LatestTime 0 topic
        if lastOffset < offset then error "offset out of range" else doConsume'' offset
    doConsume'' offset = do
      result <- fetchBytes topic offset
      liftIO . putStrLn . unlines $ (BC.unpack . B16.encode) <$> result
      doConsume'' (offset + fromIntegral (length result))
