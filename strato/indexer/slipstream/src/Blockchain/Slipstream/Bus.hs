{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

-- | Egress to the shared message bus.
--
-- Every batch slipstream commits is published twice over: the transaction
-- results it wrote (@tx_results@, so the API tier can resolve waiting
-- submitters without polling Postgres) and the contract events it derived
-- (@chain_events@, a versioned projection for the app tier's indexers and
-- any other subscriber). Both are JSON. Publishing happens after the batch
-- has committed, so a subscriber never learns of a result before Postgres
-- has it.
module Blockchain.Slipstream.Bus
  ( BusPublisher (..),
    newBusPublisher,
    ResultMessage (..),
    EventMessage (..),
  )
where

import BlockApps.Logging
import Blockchain.Data.DataDefs (TransactionResult)
import Blockchain.EthConf.Model (BusConf (..))
import Blockchain.Slipstream.Data.Action (AggregateEvent)
import Control.Monad (unless)
import Control.Monad.Composable.Streaming.Bus
import qualified Control.Monad.Composable.Streaming.Kafka as Bus
import Data.Aeson (ToJSON (..), object, (.=))
import Data.String (fromString)
import qualified Data.Text as T
import UnliftIO (MonadUnliftIO, SomeException, liftIO, try)

data BusPublisher = BusPublisher
  { publishResults :: forall m. (MonadUnliftIO m, MonadLogger m) => [TransactionResult] -> m (),
    publishEvents :: forall m. (MonadUnliftIO m, MonadLogger m) => [AggregateEvent] -> m ()
  }

-- | Envelope for @tx_results@; @version@ lets consumers cope with change.
newtype ResultMessage = ResultMessage TransactionResult

instance ToJSON ResultMessage where
  toJSON (ResultMessage r) = object ["version" .= (1 :: Int), "result" .= r]

-- | Envelope for @chain_events@.
newtype EventMessage = EventMessage AggregateEvent

instance ToJSON EventMessage where
  toJSON (EventMessage e) = object ["version" .= (1 :: Int), "event" .= e]

-- | A publisher for the configured bus. Publishing failures are logged and
-- swallowed: the bus is a projection of Postgres, which stays the source of
-- truth, and a subscriber that missed a message falls back to it.
newBusPublisher :: (MonadUnliftIO m, MonadLogger m) => BusConf -> m BusPublisher
newBusPublisher conf = do
  env <- createBusEnv "slipstream" (BusSettings (busHost conf) (busPort conf) (busSecurity conf) (busSaslUsername conf) (busSaslPassword conf))
  let results = fromString (busResultsTopic conf)
      events = fromString (busEventsTopic conf)
  Bus.runStreamMUsingEnv env $ do
    Bus.createTopicAndWait results
    Bus.createTopicAndWait events
  $logInfoS "slipstream/bus" . T.pack $
    "publishing " ++ busResultsTopic conf ++ " and " ++ busEventsTopic conf ++ " to " ++ busHost conf ++ ":" ++ show (busPort conf)
  let publish :: (MonadUnliftIO m', MonadLogger m', ToJSON a) => Bus.TopicName -> [a] -> m' ()
      publish topic items = unless (null items) $ do
        r <- try . liftIO . Bus.runStreamMUsingEnv env $ Bus.produceItemsAsJSON topic items
        case r of
          Right _ -> pure ()
          Left (e :: SomeException) -> $logWarnS "slipstream/bus" . T.pack $ "publish to " ++ show topic ++ " failed: " ++ show e
  pure BusPublisher
    { publishResults = publish results . map ResultMessage,
      publishEvents = publish events . map EventMessage
    }
