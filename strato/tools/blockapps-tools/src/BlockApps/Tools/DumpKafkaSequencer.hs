{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.DumpKafkaSequencer where

import Blockchain.EthConf
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Control.Monad.Composable.Streaming
import Control.Monad.IO.Class
import Control.Monad.Logger
import Text.Format

dumpKafkaSequencer :: IO ()
dumpKafkaSequencer = do
  mapM_
    putStrLn
    [ "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ dumpKafkaSequencer ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
      "DEPRECATED!!! seqEvents has been split into two topics: seqVmEvents, and seqP2pEvents.",
      "Please use dumpKafkaSequencerVM or dumpKafkaSequencerP2P instead.",
      "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
      ""
    ]
  dumpKafkaSequencerVM

dumpKafkaSequencerVM :: IO ()
dumpKafkaSequencerVM = runStderrLoggingT $ runStreamMConfigured "queryStrato" $
  consume "queryStrato" seqVmTasksTopicName $ \seqEvents -> do
    liftIO . putStrLn . unlines $ format <$> (seqEvents :: [VmTask])
    return ()

dumpKafkaSequencerP2P :: IO ()
dumpKafkaSequencerP2P = runStderrLoggingT $ runStreamMConfigured "queryStrato" $
  consume "queryStrato" seqP2pEventsTopicName $ \seqEvents -> do
    liftIO . putStrLn . unlines $ format <$> (seqEvents :: [P2pEvent])
    return ()
