{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.DumpKafkaVMEvents where

import Blockchain.EthConf
import Blockchain.Stream.VMEvent
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import Text.Format

dumpKafkaVMEvents :: Offset -> IO ()
dumpKafkaVMEvents startingBlock = do
  _ <- runKafkaMConfigured "queryStrato" $ doConsume' startingBlock
  return ()
  where
    doConsume' offset = do
      vmEvents <- fetchVMEvents offset
      liftIO $ putStrLn $ unlines $ map format vmEvents
      doConsume' (offset + fromIntegral (length vmEvents))
