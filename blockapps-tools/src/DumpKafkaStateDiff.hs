{-# LANGUAGE OverloadedStrings #-}

module DumpKafkaStateDiff where

import Control.Monad.IO.Class
import qualified Data.ByteString.Char8 as BC
import Data.Maybe
import Network.Kafka.Protocol

import Blockchain.Stream.Raw
import Blockchain.KafkaTopics

dumpKafkaStateDiff::Offset->IO ()
dumpKafkaStateDiff = doConsume'
  where
    doConsume' offset = do
      result <- fmap (fromMaybe (error "offset out of range")) $ fetchBytesIO (lookupTopic "statediff") offset
      liftIO $ putStrLn $ unlines $ map BC.unpack result
      doConsume' (offset + fromIntegral (length result))
