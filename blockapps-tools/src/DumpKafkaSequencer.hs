{-# LANGUAGE OverloadedStrings #-}

module DumpKafkaSequencer where

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
                                     
      liftIO $ putStrLn $ unlines $ map show seqEvents

      doConsume' (offset + fromIntegral (length seqEvents))
