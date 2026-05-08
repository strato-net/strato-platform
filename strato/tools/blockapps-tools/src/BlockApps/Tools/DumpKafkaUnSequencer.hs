{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.DumpKafkaUnSequencer where

import Blockchain.EthConf
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Control.Monad.Composable.Streaming
import Control.Monad.IO.Class
import Control.Monad.Logger
import Text.Format

dumpKafkaUnSequencer :: IO ()
dumpKafkaUnSequencer = runStderrLoggingT $ runStreamMConfigured "queryStrato" $
  consume "queryStrato" unseqEventsTopicName $ \unseqEvents -> do
    liftIO . putStrLn . unlines $ format <$> (unseqEvents :: [IngestEvent])
    return ()
