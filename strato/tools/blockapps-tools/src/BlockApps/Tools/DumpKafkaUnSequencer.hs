{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.DumpKafkaUnSequencer where

import Control.Monad.Composable.Base (runEff, withStderrLogger)
import Blockchain.EthConf
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Control.Monad.Composable.Streaming
import Control.Monad.IO.Class
import Text.Format

dumpKafkaUnSequencer :: IO ()
dumpKafkaUnSequencer = runEff . withStderrLogger $ runStreamMConfigured "queryStrato" $
  consume "queryStrato" unseqEventsTopicName $ \unseqEvents -> do
    liftIO . putStrLn . unlines $ format <$> (unseqEvents :: [IngestEvent])
    return ()
