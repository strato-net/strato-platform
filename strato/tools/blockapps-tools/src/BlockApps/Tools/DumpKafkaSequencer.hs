{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.DumpKafkaSequencer where

import Blockchain.EthConf
import Blockchain.Sequencer.Kafka
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class

dumpKafkaSequencer :: Offset -> IO ()
dumpKafkaSequencer ofs = do
  mapM_
    putStrLn
    [ "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ dumpKafkaSequencer ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
      "DEPRECATED!!! seqEvents has been split into two topics: seqVmEvents, and seqP2pEvents.",
      "Please use dumpKafkaSequencerVM or dumpKafkaSequencerP2P instead.",
      "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
      ""
    ]
  dumpKafkaSequencerVM ofs

dumpKafkaSequencerVM :: Offset -> IO ()
dumpKafkaSequencerVM startingBlock = do
  runKafkaMConfigured "queryStrato" $ doConsume' startingBlock
  where
    doConsume' offset = do
      seqEvents <- readSeqVmEvents offset
      liftIO . putStrLn . unlines $ show <$> seqEvents
      doConsume' (offset + fromIntegral (length seqEvents))

dumpKafkaSequencerP2P :: Offset -> IO ()
dumpKafkaSequencerP2P startingBlock = do
  runKafkaMConfigured "queryStrato" $ doConsume' startingBlock
  where
    doConsume' offset = do
      seqEvents <- readSeqP2pEvents offset
      liftIO . putStrLn . unlines $ show <$> seqEvents
      doConsume' (offset + fromIntegral (length seqEvents))
