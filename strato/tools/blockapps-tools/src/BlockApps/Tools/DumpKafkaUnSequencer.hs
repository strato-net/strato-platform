{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.DumpKafkaUnSequencer where

import Blockchain.EthConf
import Blockchain.Sequencer.Kafka
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import Text.Format

dumpKafkaUnSequencer :: Offset -> IO ()
dumpKafkaUnSequencer startingBlock = do
  runKafkaMConfigured "queryStrato" $ doConsume' startingBlock
  where
    doConsume' offset = do
      unseqEvents <- readUnseqEvents offset
      liftIO . putStrLn . unlines $ format <$> unseqEvents
      doConsume' (offset + fromIntegral (length unseqEvents))
