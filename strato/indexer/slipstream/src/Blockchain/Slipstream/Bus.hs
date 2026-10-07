{-# LANGUAGE DataKinds #-}
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
import Control.Concurrent (forkIO)
import Control.Monad (unless, void, when)
import Control.Monad.Composable.Base (Eff, Logger, runEff)
import Control.Monad.Composable.Streaming.Bus
import qualified Control.Monad.Composable.Streaming.Kafka as Bus
import qualified Data.Aeson as JSON
import Data.Aeson (ToJSON (..), object, (.=))
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.String (fromString)
import qualified Data.Text as T
import Data.Time.Clock (UTCTime, diffUTCTime, getCurrentTime)
import Numeric.Natural (Natural)
import UnliftIO (MonadUnliftIO, SomeException, liftIO, throwIO, try)
import UnliftIO.STM

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

-- | A publisher for the configured bus. The indexer only enqueues; a thread
-- of its own connects to the bus and publishes, so neither a bus that is
-- down nor a slow delivery timeout holds a batch up. The bus is a
-- projection of Postgres, which stays the source of truth, and a subscriber
-- that missed a message falls back to it: so after a failure the queue is
-- drained without publishing for 30s before the bus is tried again, and a
-- queue that fills up (the bus down for long) drops the oldest batches.
-- Each batch is enqueued after its rows committed, so a subscriber never
-- learns of a result before Postgres has it.
newBusPublisher :: (MonadUnliftIO m, MonadLogger m) => BusConf -> m BusPublisher
newBusPublisher conf = do
  queue <- liftIO $ newTBQueueIO queueDepth
  _ <- liftIO . forkIO . runEff . runLogging $ drain conf queue
  let results = fromString (busResultsTopic conf)
      events = fromString (busEventsTopic conf)
      publish :: (MonadUnliftIO m', MonadLogger m', ToJSON a) => Bus.TopicName -> [a] -> m' ()
      publish topic items = unless (null items) $ do
        let payloads = map (BL.toStrict . JSON.encode) items
        evicted <- liftIO . atomically $ do
          full <- isFullTBQueue queue
          when full . void $ readTBQueue queue
          writeTBQueue queue (topic, payloads)
          pure full
        when evicted $
          $logWarnS "slipstream/bus" . T.pack $ "bus queue full (" ++ show queueDepth ++ " batches); dropping the oldest"
  pure BusPublisher
    { publishResults = publish results . map ResultMessage,
      publishEvents = publish events . map EventMessage
    }

-- | Batches of encoded messages waiting for the publishing thread.
queueDepth :: Natural
queueDepth = 1024

-- | The publishing thread: connects (and creates the topics) on first use,
-- then publishes each queued batch; see 'newBusPublisher' for the failure
-- policy.
drain :: BusConf -> TBQueue (Bus.TopicName, [B.ByteString]) -> Eff '[Logger] ()
drain conf queue = loop Nothing Nothing
  where
    settings = BusSettings (busHost conf) (busPort conf) (busSecurity conf) (busSaslUsername conf) (busSaslPassword conf)
    loop :: Maybe Bus.StreamEnv -> Maybe UTCTime -> Eff '[Logger] ()
    loop mEnv failedAt = do
      batch <- liftIO . atomically $ readTBQueue queue
      now <- liftIO getCurrentTime
      if maybe False (\t -> now `diffUTCTime` t < 30) failedAt
        then loop mEnv failedAt
        else do
          (mEnv', ok) <- case mEnv of
            Just env -> publishBatch env batch
            Nothing -> do
              connected <- connect
              case connected of
                Nothing -> pure (Nothing, False)
                Just env -> publishBatch env batch
          -- The window starts when the failure is observed: the attempt
          -- itself may have spent the delivery timeout.
          failedAt' <- if ok then pure Nothing else Just <$> liftIO getCurrentTime
          loop mEnv' failedAt'
    connect = do
      r <- try . liftIO $ do
        env <- createBusEnv "slipstream" settings
        topics <- try . runEff . Bus.runStreamMUsingEnv env $ do
          Bus.createTopicAndWait (fromString (busResultsTopic conf))
          Bus.createTopicAndWait (fromString (busEventsTopic conf))
        case topics of
          Right () -> pure env
          Left (e :: SomeException) -> Bus.closeStreamEnv env >> throwIO e
      case r of
        Right env -> do
          $logInfoS "slipstream/bus" . T.pack $
            "publishing " ++ busResultsTopic conf ++ " and " ++ busEventsTopic conf ++ " to " ++ busHost conf ++ ":" ++ show (busPort conf)
          pure (Just env)
        Left (e :: SomeException) -> do
          $logWarnS "slipstream/bus" . T.pack $ "bus unavailable, Cirrus indexing continues without it (retry in 30s): " ++ show e
          pure Nothing
    publishBatch env (topic, payloads) = do
      r <- try . liftIO . runEff . Bus.runStreamMUsingEnv env $ Bus.produceToTopics [(topic, payloads)]
      case r of
        Right _ -> pure (Just env, True)
        Left (e :: SomeException) -> do
          $logWarnS "slipstream/bus" . T.pack $ "publish to " ++ show topic ++ " failed, not publishing for 30s: " ++ show e
          pure (Just env, False)
