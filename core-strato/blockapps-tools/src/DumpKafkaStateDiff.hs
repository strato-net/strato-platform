{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}

module DumpKafkaStateDiff where

import           Control.Monad          (void)
import           Control.Monad.IO.Class
import qualified Data.Aeson             as JSON
--import qualified Data.ByteString.Char8  as BC
import qualified Data.ByteString.Lazy   as BL


import           Network.Kafka
import           Network.Kafka.Protocol

import           Blockchain.EthConf
import           Blockchain.KafkaTopics
import           Blockchain.Strato.Model.Action    (Action)
import           Blockchain.Stream.Raw

import           Text.Format

toAction :: BL.ByteString -> Action
toAction x =
 case JSON.eitherDecode x of
  Left e -> error $ show e
  Right y -> y

dumpKafkaStateDiff :: Offset -> IO ()
dumpKafkaStateDiff = void . runKafkaConfigured "queryStrato" . doConsume'
  where
    topic = lookupTopic "statediff"
    doConsume' offset = do
            lastOffset <- getLastOffset LatestTime 0 topic
            if lastOffset < offset then error "offset out of range" else doConsume'' offset
    doConsume'' offset = do
      result <- fetchBytes topic offset
--      liftIO . putStrLn . unlines $ BC.unpack <$> result
      liftIO . putStrLn . unlines . map (++ "\n-----------------------\n") $ format . toAction . BL.fromStrict <$> result
      liftIO $ putStrLn "-----------------------"
      doConsume' (offset + fromIntegral (length result))
