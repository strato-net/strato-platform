{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.DumpKafkaUnSequencer where

import Blockchain.EthConf
import Blockchain.Sequencer.Kafka
import Control.Monad.IO.Class
import Network.Kafka.Protocol
import Text.Format

dumpKafkaUnSequencer :: Offset -> IO ()
dumpKafkaUnSequencer startingBlock = do
  ret <- runKafkaConfigured "queryStrato" $ doConsume' startingBlock
  case ret of
    Left e -> error $ show e
    Right _ -> return ()
  where
    doConsume' offset = do
      unseqEvents <- readUnseqEvents offset
      liftIO . putStrLn . unlines $ format <$> unseqEvents
      doConsume' (offset + fromIntegral (length unseqEvents))
