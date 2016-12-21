{-# LANGUAGE OverloadedStrings #-}


module DumpKafkaUnminedBlocks where

import Control.Lens
import Control.Monad.IO.Class
import Network.Kafka
import Network.Kafka.Protocol

import Blockchain.Format
import Blockchain.Stream.UnminedBlock
import Blockchain.EthConf

dumpKafkaUnminedBlocks::Offset->IO ()
dumpKafkaUnminedBlocks startingBlock = do
  ret <- runKafkaConfigured "queryStrato" $ doConsume' startingBlock
  case ret of
    Left e -> error $ show e
    Right _ -> return ()
  where
    doConsume' offset = do
      stateRequiredAcks .= -1
      stateWaitSize .= 1
      stateWaitTime .= 100000
      blocks <- fetchUnminedBlocks offset
                                     
      liftIO $ putStrLn $ unlines $ map format blocks

      doConsume' (offset + fromIntegral (length blocks))
