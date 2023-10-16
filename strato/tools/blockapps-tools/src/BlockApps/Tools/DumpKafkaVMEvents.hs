{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.DumpKafkaVMEvents where

import Blockchain.EthConf
import Blockchain.Stream.VMEvent
import Control.Monad.IO.Class
import Network.Kafka.Protocol
import Text.Format

dumpKafkaVMEvents :: Offset -> IO ()
dumpKafkaVMEvents startingBlock = do
  ret <- runKafkaConfigured "queryStrato" $ doConsume' startingBlock
  case ret of
    Left e -> error $ show e
    Right _ -> return ()
  where
    doConsume' offset = do
      vmEvents <- fetchVMEvents offset
      liftIO $ putStrLn $ unlines $ map format vmEvents
      doConsume' (offset + fromIntegral (length vmEvents))
