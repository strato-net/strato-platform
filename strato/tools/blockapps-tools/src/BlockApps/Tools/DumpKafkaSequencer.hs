{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.DumpKafkaSequencer where

import Blockchain.EthConf
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import Control.Monad.Logger
import Text.Format

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

--ignoring startingBlock for now, might fix this later, but it won't apply to RabbitMQ
dumpKafkaSequencerVM :: Offset -> IO ()
dumpKafkaSequencerVM startingBlock | startingBlock /= 0 = error "startingBlock currently can only equal 0"
dumpKafkaSequencerVM _ = runStderrLoggingT $ runKafkaMConfigured "queryStrato" $
  consume "queryStrato" "queryStrato" seqVmEventsTopicName $ \() seqEvents -> do
    liftIO . putStrLn . unlines $ format <$> (seqEvents :: [VmEvent])
    return ()

--ignoring startingBlock for now, might fix this later, but it won't apply to RabbitMQ
dumpKafkaSequencerP2P :: Offset -> IO ()
dumpKafkaSequencerP2P startingBlock | startingBlock /= 0 = error "startingBlock currently can only equal 0"
dumpKafkaSequencerP2P _ = runStderrLoggingT $ runKafkaMConfigured "queryStrato" $
  consume "queryStrato" "queryStrato" seqP2pEventsTopicName $ \() seqEvents -> do
    liftIO . putStrLn . unlines $ format <$> (seqEvents :: [P2pEvent])
    return ()
