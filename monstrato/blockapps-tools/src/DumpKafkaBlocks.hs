{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
module DumpKafkaBlocks where

import           Control.Monad.IO.Class
import           Network.Kafka.Protocol

import           Blockchain.EthConf
import           Blockchain.Format
import           Blockchain.Stream.Raw     (setDefaultKafkaState)
import           Blockchain.Stream.VMEvent

dumpKafkaBlocks :: Offset -> IO ()
dumpKafkaBlocks startingBlock = do
  ret <- runKafkaConfigured "queryStrato" $ doConsume' startingBlock
  case ret of
    Left e  -> error $ show e
    Right _ -> return ()
  where
    doConsume' offset = do
      setDefaultKafkaState
      vmEvents <- fetchVMEvents offset
      liftIO $ putStrLn $ unlines $ map format vmEvents
      doConsume' (offset + fromIntegral (length vmEvents))
