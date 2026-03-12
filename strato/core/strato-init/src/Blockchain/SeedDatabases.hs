{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.SeedDatabases
  ( mkKafkaTopics
  ) where

import BlockApps.Logging
import Control.Monad
import Control.Monad.Composable.Kafka
import Data.String
import qualified Data.Text as T

-- | Create Kafka topics.
-- Called by seed-genesis after docker containers are running.
-- Database creation and migrations are now handled by strato-index on startup.
mkKafkaTopics :: (MonadLoggerIO m, HasKafka m) => m ()
mkKafkaTopics = do
  let topics =
        [ "solidvmevents"
        ]

  $logInfoS "seed-genesis" . T.pack $ "Creating Kafka topics: " ++ show topics
  forM_ topics $ createTopicAndWait . fromString

  $logInfoS "seed-genesis" "Kafka topic creation complete"
