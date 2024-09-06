{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.DumpKafkaUnSequencer where

import Blockchain.EthConf
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import Control.Monad.Logger
import Text.Format

--ignoring startingBlock for now, might fix this later, but it won't apply to RabbitMQ
dumpKafkaUnSequencer :: Offset -> IO ()
dumpKafkaUnSequencer startingBlock | startingBlock /= 0 = error "startingBlock currently can only equal 0"
dumpKafkaUnSequencer _ = runStderrLoggingT $ runKafkaMConfigured "queryStrato" $
  consume "queryStrato" "queryStrato" unseqEventsTopicName $ \() unseqEvents -> do
    liftIO . putStrLn . unlines $ format <$> (unseqEvents :: [IngestEvent])
    return ()
