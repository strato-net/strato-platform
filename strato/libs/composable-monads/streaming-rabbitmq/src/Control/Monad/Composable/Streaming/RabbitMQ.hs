{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeSynonymInstances #-}

-- | RabbitMQ streaming backend using amqp library.
--
-- Mapping from Kafka concepts:
--   TopicName -> Queue name (fanout exchange with same name)
--   ConsumerGroup -> Queue name (competing consumers pattern)
--   Offset -> Not applicable (RabbitMQ uses acks, not offsets)

module Control.Monad.Composable.Streaming.RabbitMQ (
  -- Core types
  StreamM,
  HasStreaming,
  StreamEnv(..),
  TopicName(..),
  ConsumerGroup,
  ClientId,
  StreamAddress,
  -- Running
  runStreamM,
  runStreamMUsingEnv,
  createStreamEnv,
  getStreamEnv,
  -- Producing
  produceItems,
  produceItemsAsJSON,
  -- Consuming
  consume,
  runConsume,
  consumeFromLatest,
  -- Topics
  createTopicAndWait,
  -- Conduit
  conduitBatchSource,
  -- Deprecated compatibility
  ProduceResponse(..),
  Offset(..)
  ) where

import Conduit
import Control.Concurrent (threadDelay)
import Control.Concurrent.STM
import Control.Monad (void, forever)
import Control.Monad.Composable.Base
import Control.Monad.Reader
import qualified Data.Aeson as JSON
import Data.Binary
import Data.IORef
import Data.Int (Int64)
import Data.Text (Text)
import qualified Network.AMQP as AMQP

-- Compatibility types
newtype Offset = Offset { unOffset :: Int64 }
  deriving (Show, Eq, Ord)

data ProduceResponse = ProduceResponse
  deriving (Show, Eq)

newtype TopicName = TopicName { unTopicName :: Text }
  deriving (Show, Eq, Ord)

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

runStreamM :: MonadIO m => ClientId -> StreamAddress -> StreamM m a -> m a
runStreamM x y f = flip runStreamMUsingEnv f =<< createStreamEnv x y

----------------------
--    Producing     --
----------------------

produceItems :: (Binary a, HasStreaming m) => TopicName -> [a] -> m [ProduceResponse]
produceItems topicName events = do
  env <- getStreamEnv
  let chan = seChannel env
      exchange = unTopicName topicName
  liftIO $ do
    mapM_ (\e -> AMQP.publishMsg chan exchange ""
            AMQP.newMsg { AMQP.msgBody = encode e
                        , AMQP.msgDeliveryMode = Just AMQP.Persistent
                        }) events
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

runConsume :: (Binary a, HasStreaming m) =>
              ConsumerGroup -> TopicName -> ([a] -> m (Maybe b)) -> m b
runConsume consumerGroup topicName f = do
  env <- getStreamEnv
  let chan = seChannel env
      queueName = unTopicName topicName <> "-" <> consumerGroup
  
  resultVar <- liftIO $ newTVarIO Nothing
  
  liftIO $ do
    _ <- AMQP.consumeMsgs chan queueName AMQP.Ack $ \(msg, envelope) -> do
      let payload = decode (AMQP.msgBody msg)
      atomically $ writeTVar resultVar (Just (payload, envelope))
    return ()
  
  consumeLoop chan resultVar
  where
    consumeLoop chan resultVar = do
      mItem <- liftIO $ atomically $ do
        r <- readTVar resultVar
        case r of
          Nothing -> retry
          Just x -> do
            writeTVar resultVar Nothing
            return x
      
      case mItem of
        (item, envelope) -> do
          mResult <- f [item]
          liftIO $ AMQP.ackEnv envelope
          case mResult of
            Just result -> return result
            Nothing -> consumeLoop chan resultVar

consumeFromLatest :: (Binary a, HasStreaming m) =>
                     TopicName -> m () -> ([a] -> m (Maybe b)) -> m b
consumeFromLatest topicName initAction f = do
  env <- getStreamEnv
  let chan = seChannel env
      exchange = unTopicName topicName
  
  -- Create temporary exclusive queue for "from latest" semantics
  (queueName, _, _) <- liftIO $ AMQP.declareQueue chan AMQP.newQueue
    { AMQP.queueExclusive = True
    , AMQP.queueAutoDelete = True
    }
  
  liftIO $ AMQP.bindQueue chan queueName exchange ""
  
  -- Run init action after binding (so we catch messages produced by it)
  initAction
  
  resultVar <- liftIO $ newTVarIO Nothing
  
  liftIO $ do
    _ <- AMQP.consumeMsgs chan queueName AMQP.Ack $ \(msg, envelope) -> do
      let payload = decode (AMQP.msgBody msg)
      atomically $ writeTVar resultVar (Just (payload, envelope))
    return ()
  
  consumeLoop chan resultVar
  where
    consumeLoop chan resultVar = do
      mItem <- liftIO $ atomically $ do
        r <- readTVar resultVar
        case r of
          Nothing -> retry
          Just x -> do
            writeTVar resultVar Nothing
            return x
      
      case mItem of
        (item, envelope) -> do
          result <- f [item]
          liftIO $ AMQP.ackEnv envelope
          case result of
            Just val -> return val
            Nothing -> consumeLoop chan resultVar

conduitBatchSource :: (MonadIO m, Binary a) =>
                      ClientId -> StreamAddress -> TopicName -> ConduitT i [a] m b
conduitBatchSource clientId streamAddress topicName = do
  env <- createStreamEnv clientId streamAddress
  let chan = seChannel env
      exchange = unTopicName topicName
  
  -- Create exclusive queue for this conduit
  (queueName, _, _) <- liftIO $ AMQP.declareQueue chan AMQP.newQueue
    { AMQP.queueExclusive = True
    , AMQP.queueAutoDelete = True
    }
  
  liftIO $ AMQP.bindQueue chan queueName exchange ""
  
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
  
  -- Declare fanout exchange (acts like Kafka topic)
  liftIO $ AMQP.declareExchange chan AMQP.newExchange
    { AMQP.exchangeName = exchange
    , AMQP.exchangeType = "fanout"
    , AMQP.exchangeDurable = True
    }
  
  -- Declare default queue for persistent consumers
  liftIO $ void $ AMQP.declareQueue chan AMQP.newQueue
    { AMQP.queueName = exchange
    , AMQP.queueDurable = True
    }
  
  liftIO $ AMQP.bindQueue chan exchange exchange ""
