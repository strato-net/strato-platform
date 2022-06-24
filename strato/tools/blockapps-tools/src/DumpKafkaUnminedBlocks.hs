{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
module DumpKafkaUnminedBlocks where

import           Control.Monad.IO.Class
import           Network.Kafka.Protocol

import           Blockchain.EthConf
import           Blockchain.Stream.UnminedBlock

import           Text.Format

dumpKafkaUnminedBlocks::Offset->IO ()
dumpKafkaUnminedBlocks startingBlock = do
  ret <- runKafkaConfigured "queryStrato" $ doConsume' startingBlock
  case ret of
    Left e  -> error $ show e
    Right _ -> return ()
  where
    doConsume' offset = do
      blocks <- fetchUnminedBlocks offset
      liftIO . putStrLn . unlines $ format <$> blocks
      doConsume' (offset + fromIntegral (length blocks))
