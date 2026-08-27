{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeSynonymInstances #-}

-- | RabbitMQ streaming backend using amqp library.
--
-- Mapping from Kafka concepts:
--   TopicName -> Fanout exchange + shared queue (same name)
--   ConsumerGroup -> Ignored (all consumers share one queue per topic)
--   Offset -> Not applicable (RabbitMQ uses acks, not offsets)
--
-- Note: Multiple consumers on same topic will compete for messages (round-robin),
-- not each receive all messages. For pub-sub, use separate topics.

module Control.Monad.Composable.Streaming.RabbitMQ (
  -- Core types
  StreamM,
  HasStreaming,
  StreamEnv(..),
  TopicName(..),
  ConsumerGroup,
  ClientId,
  StreamAddress,
  MonadUnliftIO,
  -- Running
  runStreamM,
  runStreamMUsingEnv,
  createStreamEnv,
  closeStreamEnv,
  getStreamEnv,
  -- Producing
  produceItems,
  produceItemsAsJSON,
  produceToTopics,
  -- Consuming
  consume,
  consumeBroadcast,
  runConsume,
  consumeFromLatest,
  -- Topics
  createTopicAndWait,
  createBroadcastTopic,
  -- Conduit
  conduitBatchSource,
  -- Deprecated compatibility
  ProduceResponse(..),
  Offset(..)
  ) where

import Conduit
import Control.Concurrent (threadDelay)
import Control.Concurrent.STM
import Control.Exception (bracket)
import Control.Monad (void, forever)
import Control.Monad.Composable.Base
import Control.Monad.Reader
import qualified Data.Aeson as JSON
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.IORef
import Data.Int (Int64)
import Data.String (IsString)
import Data.Text (Text)
import qualified Network.AMQP as AMQP

-- Compatibility types
newtype Offset = Offset { unOffset :: Int64 }
  deriving (Show, Eq, Ord)

data ProduceResponse = ProduceResponse
  deriving (Show, Eq)

newtype TopicName = TopicName { unTopicName :: Text }
  deriving (Show, Eq, Ord, IsString)

type ClientId = Text
type StreamAddress = (String, Int)
type ConsumerGroup = Text

type StreamM = ReaderT (IORef StreamEnv)
type HasStreaming m = (MonadIO m, AccessibleEnv (IORef StreamEnv) m)

data StreamEnv = StreamEnv
  { seConnection :: AMQP.Connection
  , seChannel    :: AMQP.Channel
  , seClientId   :: Text
  }

createStreamEnv :: MonadIO m => ClientId -> StreamAddress -> m StreamEnv
createStreamEnv clientId (host, port) = liftIO $ do
  conn <- AMQP.openConnection' host (fromIntegral port) "/" "guest" "guest"
  chan <- AMQP.openChannel conn
  return $ StreamEnv conn chan clientId

getStreamEnv :: HasStreaming m => m StreamEnv
getStreamEnv = do
  ref <- accessEnv
  liftIO $ readIORef ref

runStreamMUsingEnv :: MonadIO m => StreamEnv -> StreamM m a -> m a
runStreamMUsingEnv env f = do
  ref <- liftIO $ newIORef env
  runReaderT f ref

-- | Run a streaming action, then close the connection. Use for short-lived operations.
-- Connection is always closed, even if the action throws an exception.
runStreamM :: MonadUnliftIO m => ClientId -> StreamAddress -> StreamM m a -> m a
runStreamM clientId addr f = withRunInIO $ \runInIO -> bracket
  (createStreamEnvIO clientId addr)
  (AMQP.closeConnection . seConnection)
  (\env -> do
    ref <- newIORef env
    runInIO $ runReaderT f ref)

createStreamEnvIO :: ClientId -> StreamAddress -> IO StreamEnv
createStreamEnvIO clientId (host, port) = do
  conn <- AMQP.openConnection' host (fromIntegral port) "/" "guest" "guest"
  chan <- AMQP.openChannel conn
  return $ StreamEnv conn chan clientId

-- | Close a StreamEnv's connection. Call when done with a long-lived env.
closeStreamEnv :: MonadIO m => StreamEnv -> m ()
closeStreamEnv env = liftIO $ AMQP.closeConnection (seConnection env)

----------------------
--    Producing     --
----------------------

produceItems :: (Binary a, HasStreaming m) => TopicName -> [a] -> m [ProduceResponse]
produceItems topicName events = do
  env <- getStreamEnv
  let chan = seChannel env
      exchange = unTopicName topicName
  liftIO $ mapM_ (\e -> AMQP.publishMsg chan exchange ""
          AMQP.newMsg { AMQP.msgBody = encode e
                      , AMQP.msgDeliveryMode = Just AMQP.Persistent
                      }) events
  return [ProduceResponse]

-- | Publish already-encoded payloads to several exchanges in one call.
--
-- This exists so callers can stay backend-agnostic: on the Kafka backend the
-- equivalent collapses N synchronous acks=all round trips into one, which is
-- the whole point of the entry point. AMQP publishes are already fire-and-
-- forget on the open channel, so this is just a loop -- it is here for
-- interface parity, not for a speedup.
--
-- Callers encode their own payloads because the topics generally carry
-- different types.
produceToTopics :: HasStreaming m => [(TopicName, [B.ByteString])] -> m [ProduceResponse]
produceToTopics groups = do
  env <- getStreamEnv
  let chan = seChannel env
      publish exchange raw = AMQP.publishMsg chan exchange ""
        AMQP.newMsg { AMQP.msgBody = BL.fromStrict raw
                    , AMQP.msgDeliveryMode = Just AMQP.Persistent
                    }
  liftIO $ mapM_ (\(topicName, raws) -> mapM_ (publish $ unTopicName topicName) raws) groups
  return [ProduceResponse]

produceItemsAsJSON :: (JSON.ToJSON a, HasStreaming m) => TopicName -> [a] -> m [ProduceResponse]
produceItemsAsJSON topicName events = do
  env <- getStreamEnv
  let chan = seChannel env
      exchange = unTopicName topicName
  liftIO $ do
    mapM_ (\e -> AMQP.publishMsg chan exchange ""
            AMQP.newMsg { AMQP.msgBody = JSON.encode e
                        , AMQP.msgDeliveryMode = Just AMQP.Persistent
                        }) events
  return [ProduceResponse]

----------------------
--Consuming/Fetching--
----------------------

consume :: (Binary a, HasStreaming m) =>
           ConsumerGroup -> TopicName -> ([a] -> m ()) -> m ()
consume consumerGroup topicName f =
  void $ runConsume consumerGroup topicName (\a -> Nothing <$ f a)

-- | Alias for consume (for API compatibility).
consumeBroadcast :: (Binary a, HasStreaming m) =>
                    ConsumerGroup -> TopicName -> ([a] -> m ()) -> m ()
consumeBroadcast = consume

runConsume :: (Binary a, HasStreaming m) =>
              ConsumerGroup -> TopicName -> ([a] -> m (Maybe b)) -> m b
runConsume _consumerGroup topicName f = do
  env <- getStreamEnv
  let chan = seChannel env
      exchange = unTopicName topicName
      queueName = exchange  -- Shared queue (same name as topic)
  
  -- Ensure exchange, queue, and binding all exist (idempotent)
  liftIO $ do
    AMQP.declareExchange chan AMQP.newExchange
      { AMQP.exchangeName = exchange
      , AMQP.exchangeType = "fanout"
      , AMQP.exchangeDurable = True
      }
    _ <- AMQP.declareQueue chan AMQP.newQueue
      { AMQP.queueName = queueName
      , AMQP.queueDurable = True
      }
    AMQP.bindQueue chan queueName exchange ""
  
  -- Use a TQueue to properly queue up incoming messages
  msgQueue <- liftIO newTQueueIO
  
  liftIO $ do
    _ <- AMQP.consumeMsgs chan queueName AMQP.Ack $ \(msg, envelope) -> do
      let payload = decode (AMQP.msgBody msg)
      atomically $ writeTQueue msgQueue (payload, envelope)
    return ()
  
  consumeLoop msgQueue
  where
    consumeLoop msgQueue = do
      (item, envelope) <- liftIO $ atomically $ readTQueue msgQueue
      mResult <- f [item]
      liftIO $ AMQP.ackEnv envelope
      case mResult of
        Just result -> return result
        Nothing -> consumeLoop msgQueue

consumeFromLatest :: (Binary a, HasStreaming m) =>
                     TopicName -> m () -> ([a] -> m (Maybe b)) -> m b
consumeFromLatest topicName initAction f = do
  env <- getStreamEnv
  let chan = seChannel env
      exchange = unTopicName topicName
  
  -- Ensure exchange exists
  liftIO $ AMQP.declareExchange chan AMQP.newExchange
    { AMQP.exchangeName = exchange
    , AMQP.exchangeType = "fanout"
    , AMQP.exchangeDurable = True
    }
  
  -- Create temporary exclusive queue for "from latest" semantics
  (queueName, _, _) <- liftIO $ AMQP.declareQueue chan AMQP.newQueue
    { AMQP.queueExclusive = True
    , AMQP.queueAutoDelete = True
    }
  
  liftIO $ AMQP.bindQueue chan queueName exchange ""
  
  -- Run init action after binding (so we catch messages produced by it)
  initAction
  
  -- Use TQueue to properly queue up incoming messages
  msgQueue <- liftIO newTQueueIO
  
  liftIO $ do
    _ <- AMQP.consumeMsgs chan queueName AMQP.Ack $ \(msg, envelope) -> do
      let payload = decode (AMQP.msgBody msg)
      atomically $ writeTQueue msgQueue (payload, envelope)
    return ()
  
  consumeLoop msgQueue
  where
    consumeLoop msgQueue = do
      (item, envelope) <- liftIO $ atomically $ readTQueue msgQueue
      result <- f [item]
      liftIO $ AMQP.ackEnv envelope
      case result of
        Just val -> return val
        Nothing -> consumeLoop msgQueue

conduitBatchSource :: (MonadIO m, Binary a) =>
                      ClientId -> StreamAddress -> TopicName -> ConduitT i [a] m b
conduitBatchSource clientId streamAddress topicName = do
  env <- createStreamEnv clientId streamAddress
  let chan = seChannel env
      exchange = unTopicName topicName
      queueName = exchange  -- Same queue name as topic (point-to-point)
      _ = clientId  -- unused, kept for API compatibility
  
  -- Ensure exchange, queue, and binding all exist
  liftIO $ do
    AMQP.declareExchange chan AMQP.newExchange
      { AMQP.exchangeName = exchange
      , AMQP.exchangeType = "fanout"
      , AMQP.exchangeDurable = True
      }
    _ <- AMQP.declareQueue chan AMQP.newQueue
      { AMQP.queueName = queueName
      , AMQP.queueDurable = True
      }
    AMQP.bindQueue chan queueName exchange ""
  
  batchVar <- liftIO $ newTVarIO []
  
  liftIO $ do
    _ <- AMQP.consumeMsgs chan queueName AMQP.Ack $ \(msg, envelope) -> do
      let payload = decode (AMQP.msgBody msg)
      atomically $ modifyTVar batchVar (payload :)
      AMQP.ackEnv envelope
    return ()
  
  forever $ do
    liftIO $ threadDelay 100000  -- 100ms batch window
    batch <- liftIO $ atomically $ do
      items <- readTVar batchVar
      writeTVar batchVar []
      return (reverse items)
    yield batch

----------------------
--  Topic creation  --
----------------------

createTopicAndWait :: HasStreaming m => TopicName -> m ()
createTopicAndWait topicName = do
  env <- getStreamEnv
  let chan = seChannel env
      exchange = unTopicName topicName
      queueName = exchange  -- Same name for shared queue
  
  -- Declare fanout exchange
  liftIO $ AMQP.declareExchange chan AMQP.newExchange
    { AMQP.exchangeName = exchange
    , AMQP.exchangeType = "fanout"
    , AMQP.exchangeDurable = True
    }
  
  -- Also create and bind a queue with the same name (shared by all consumers)
  liftIO $ do
    _ <- AMQP.declareQueue chan AMQP.newQueue
      { AMQP.queueName = queueName
      , AMQP.queueDurable = True
      }
    AMQP.bindQueue chan queueName exchange ""

-- | Alias for createTopicAndWait (for API compatibility)
createBroadcastTopic :: HasStreaming m => TopicName -> m ()
createBroadcastTopic = createTopicAndWait
