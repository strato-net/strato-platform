{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
module DumpKafkaBlocks where

import           Control.Monad.IO.Class
import           Network.Kafka.Protocol

import           Blockchain.EthConf
import           Blockchain.Stream.VMEvent

import           Text.Format

dumpKafkaBlocks :: Offset -> IO ()
dumpKafkaBlocks startingBlock = do
  ret <- runKafkaConfigured "queryStrato" $ doConsume' startingBlock
  case ret of
    Left e  -> error $ show e
    Right _ -> return ()
  where
    doConsume' offset = do
      vmEvents <- fetchVMEvents offset
      liftIO $ putStrLn $ unlines $ map format vmEvents
      doConsume' (offset + fromIntegral (length vmEvents))
