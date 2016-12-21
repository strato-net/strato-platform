{-# LANGUAGE OverloadedStrings #-}


module DumpKafkaStateDiff where

import Control.Lens
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Base16 as B16
--import Data.Text as T
import qualified Data.ByteString.Char8 as BC
import Data.Maybe
import Network.Kafka
import Network.Kafka.Consumer
import Network.Kafka.Protocol

import qualified Data.Aeson as Aeson
import Blockchain.Data.StateDiff

import Blockchain.Stream.Raw
import Blockchain.EthConf
import Blockchain.KafkaTopics

dumpKafkaStateDiff::Offset->IO ()
dumpKafkaStateDiff startingBlock = do
  doConsume' startingBlock
  where
    doConsume' offset = do
      --result :: IO (Data.ByteString.Internal.ByteString)
      result <- fmap (fromMaybe (error "offset out of range")) $ fetchBytesIO (lookupTopic "statediff") offset
      --liftIO $ putStrLn $ unlines $ map (BC.unpack . B16.encode) result
      liftIO $ putStrLn $ unlines $ map BC.unpack result
      doConsume' (offset + fromIntegral (length result))

    --theJSON x = (Aeson.decode $ BL.fromStrict $ x :: Maybe Aeson.Value)
    --readJSON x = fromMaybe "" (Aeson.toJSON $ theJSON x)