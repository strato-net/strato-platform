{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeSynonymInstances #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}

module Control.Monad.Composable.Kafka (
  -- Core types
  StreamM,
  HasStreaming,
  StreamEnv(..),
  TopicName,
  ConsumerGroup,
  ClientId,
  StreamAddress,
  MonadUnliftIO,
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
  consumeBroadcast,
  runConsume,
  consumeFromLatest,
  -- Topics
  createTopicAndWait,
  createBroadcastTopic,
  -- Conduit
  conduitBatchSource,
  -- Deprecated/internal (for migration)
  KafkaM,
  HasKafka,
  KafkaEnv,
  KafkaString(..),
  KafkaAddress,
  KafkaClientId,
  Offset,
  ProduceResponse,
  runKafkaM,
  runKafkaMUsingEnv,
  createKafkaEnv,
  getKafkaEnv
  ) where

import Blockchain.MilenaTools
import Conduit
import Control.Concurrent (threadDelay)
import Control.Lens
import Control.Monad (void)
import Control.Monad.Composable.Base
import Control.Monad.Loops
import Control.Monad.Reader
import Control.Monad.Trans.Except
import Control.Monad.Trans.State
import qualified Data.Aeson as JSON
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.IORef
import Data.List
import qualified Data.Map as M
import Data.Maybe (isJust)
import Data.Text (Text)
import qualified Data.Text.Encoding as TE

import Network.Kafka hiding (createTopic)
import qualified Network.Kafka as Milena
import Network.Kafka.Consumer
import Network.Kafka.Producer
import Network.Kafka.Protocol hiding (ClientId)



-- Generic streaming type aliases
type StreamM = ReaderT (IORef KafkaState)
type HasStreaming m = (MonadIO m, AccessibleEnv (IORef KafkaState) m)
type ClientId = Text
type StreamAddress = (String, Int)

-- Internal conversion from Text to Milena's KString
toKafkaClientId :: ClientId -> KafkaClientId
toKafkaClientId = KString . TE.encodeUtf8

data StreamEnv = StreamEnv
  { streamStateIORef :: IORef KafkaState
  }

-- Deprecated aliases for backward compatibility
type KafkaM = StreamM
type HasKafka m = HasStreaming m
type KafkaEnv = StreamEnv

kafkaStateIORef :: StreamEnv -> IORef KafkaState
kafkaStateIORef = streamStateIORef

createStreamEnv ::
  MonadIO m =>
  ClientId ->
  StreamAddress ->
  m StreamEnv
createStreamEnv clientId (host, port) = do
  let kafkaClientId = toKafkaClientId clientId
      kafkaAddress = (Host (KString (BC.pack host)), Port (fromIntegral port))
      kafkaState =
        (mkKafkaState kafkaClientId kafkaAddress)
          { _stateRequiredAcks = -1,
            _stateWaitSize = 1, -- Awaken from sleep only if there is at least one message
            _stateWaitTime = 100000 -- 100s
          }

  kafkaStateToStreamEnv kafkaState

kafkaStateToStreamEnv :: MonadIO m =>
                         KafkaState -> m StreamEnv
kafkaStateToStreamEnv kafkaState = do
  ksIORef <- liftIO $ newIORef kafkaState
  return $ StreamEnv ksIORef

getStreamEnv :: HasStreaming m => m StreamEnv
getStreamEnv = StreamEnv <$> accessEnv

runStreamMUsingEnv :: StreamEnv -> StreamM m a -> m a
runStreamMUsingEnv env f =
  runReaderT f $ streamStateIORef env

runStreamM :: MonadUnliftIO m => ClientId -> StreamAddress -> StreamM m a -> m a
runStreamM x y f = flip runStreamMUsingEnv f =<< createStreamEnv x y

-- Deprecated aliases (accept old types for backward compatibility)
createKafkaEnv :: MonadIO m => KafkaClientId -> KafkaAddress -> m StreamEnv
createKafkaEnv (KString cid) (Host (KString host), Port port) =
  createStreamEnv (TE.decodeUtf8 cid) (BC.unpack host, fromIntegral port)

getKafkaEnv :: HasStreaming m => m StreamEnv
getKafkaEnv = getStreamEnv

runKafkaMUsingEnv :: StreamEnv -> StreamM m a -> m a
runKafkaMUsingEnv = runStreamMUsingEnv

runKafkaM :: MonadIO m => KafkaClientId -> KafkaAddress -> StreamM m a -> m a
runKafkaM cid addr f = flip runStreamMUsingEnv f =<< createKafkaEnv cid addr

execKafka ::
  HasStreaming m =>
  StateT KafkaState (ExceptT KafkaClientError IO) a ->
  m a
execKafka f = do
  ksIORef <- accessEnv
  ks <- liftIO $ readIORef ksIORef
  result <- liftIO $ runExceptT $ runStateT f ks
  case result of
    Left e -> error $ show e
    Right (v, ks') -> do
      liftIO $ writeIORef ksIORef ks'
      return v


----------------------
--   Checkpoints    --
----------------------

getKafkaCheckpoint :: HasStreaming m =>
                      ConsumerGroup -> TopicName -> m Offset
getKafkaCheckpoint consumerGroup topicName =
  execKafka (fetchSingleOffset consumerGroup topicName 0) >>= \case
    Left UnknownTopicOrPartition -> do
      setKafkaCheckpoint consumerGroup topicName 0
      return 0
    Left err -> error $ "Unexpected response when fetching offset for " ++ show consumerGroup ++ ": " ++ show err
    Right (o, _) -> return o

setKafkaCheckpoint :: HasStreaming m =>
                      ConsumerGroup -> TopicName -> Offset -> m ()
setKafkaCheckpoint consumerGroup topicName ofs = do
  op' <- execKafka $ commitSingleOffset consumerGroup topicName 0 ofs ""
  case op' of
    Left err -> error $ "Client error: " ++ show err
    Right _ -> return ()


----------------------
--    Producing     --
----------------------

produceItems :: (Binary a, HasStreaming m) => TopicName -> [a] -> m [ProduceResponse]
produceItems topicName events = do
  results <-
    execKafka $ produceMessagesAsSingletonSets $
      (TopicAndMessage topicName . makeMessage . BL.toStrict . encode) <$> events
  liftIO $ mapM_ parseKafkaResponse results
  return results

produceItemsAsJSON :: (JSON.ToJSON a, HasStreaming m) => TopicName -> [a] -> m [ProduceResponse]
produceItemsAsJSON topicName events = do
  results <-
    execKafka $ produceMessagesAsSingletonSets $
      (TopicAndMessage topicName . makeMessage . BL.toStrict . JSON.encode) <$> events
  liftIO $ mapM_ parseKafkaResponse results
  return results

----------------------
--Consuming/Fetching--
----------------------

consume :: (Binary a, HasStreaming m) =>
           ConsumerGroup -> TopicName -> ([a] -> m ()) -> m ()
consume consumerGroup topicName f = void $ runConsume consumerGroup topicName (\a -> Nothing <$ f a)

-- | Pub-sub consume: in Kafka, consumer groups already provide this behavior,
-- so this is just an alias for 'consume'.
consumeBroadcast :: (Binary a, HasStreaming m) =>
                    ConsumerGroup -> TopicName -> ([a] -> m ()) -> m ()
consumeBroadcast = consume

runConsume :: (Binary a, HasStreaming m) =>
              ConsumerGroup -> TopicName -> ([a] -> m (Maybe b)) -> m b
runConsume consumerGroup topicName f = consumeOnce
  where
    consumeOnce = do
      offset <- getKafkaCheckpoint consumerGroup topicName
      items <- fetchItems topicName offset
      mReturnVal <- f items
      let nextOffset' = offset + fromIntegral (length items)
      setKafkaCheckpoint consumerGroup topicName nextOffset'
      case mReturnVal of
        Just returnVal -> pure returnVal
        Nothing -> consumeOnce

consumeFromLatest :: (Binary a, HasStreaming m) =>
                     TopicName -> m () -> ([a] -> m (Maybe b)) -> m b
consumeFromLatest topicName initAction f = do
  startOffset <- execKafka $ getLastOffset LatestTime 0 topicName
  initAction
  consumeLoop startOffset
  where
    consumeLoop offset = do
      items <- fetchItems topicName offset
      result <- f items
      case result of
        Just val -> return val
        Nothing -> consumeLoop (offset + fromIntegral (length items))

fetchItems :: (Binary a, HasStreaming m) =>
              TopicName -> Offset -> m [a]
fetchItems topicName offset = map (decode . BL.fromStrict) <$> fetchBytes topicName offset

fetchBytes :: HasStreaming m => TopicName -> Offset -> m [B.ByteString]
fetchBytes topic offset = do
  fetched <- execKafka $ fetch offset 0 topic

  let errorStatuses = concat $ map (^.. _2 . folded . _2) (fetched ^. fetchResponseFields)
  --If the Kafka fetch fails, this is a critical error, we have no choice but to halt the program.
  --Also, since the Kafka fetch is typically in a loop, by not halting, we will often create a
  --fast infinite loop that will eat 100% of the CPU and quickly fill up the logs.
  case find (/= NoError) errorStatuses of
    Just e -> error $ "There was a critical Kafka error while fetching messages: " ++ show e ++ "\ntopic = " ++ BC.unpack (topic ^. tName ^. kString) ++ ", offset = " ++ show offset
    _ -> return ()

  return $ fetchResponseToPayload [offset] fetched

conduitBatchSource :: (MonadIO m, Binary a) =>
                      ClientId -> StreamAddress -> TopicName -> ConduitT i [a] m b
conduitBatchSource clientId streamAddress topicName = do
  env <- createStreamEnv clientId streamAddress
  startingOffset <- runStreamMUsingEnv env $ execKafka $ getLastOffset LatestTime 0 topicName

  flip iterateM_ startingOffset $ \offset -> do
      items <- runStreamMUsingEnv env $ fetchItems topicName offset
      yield items
      return $ offset + fromIntegral (length items)

createTopic :: HasStreaming m =>
               TopicName -> m ()
createTopic name = do
  TopicsResp result <- execKafka $ Milena.createTopic $ createTopicsRequest name 1 1 [] []
  let errors = filter ((/= NoError) . snd) result
  case errors of
    [] -> return ()
    [(_, TopicAlreadyExists)] -> return () -- No problem, it was already there
    _ -> error $ "Error creating kafka topic " ++ show name ++ ": " ++ show errors

createTopicAndWait :: HasStreaming m => TopicName -> m ()
createTopicAndWait name = do
  createTopic name
  waitForLeader (50 :: Int)  -- max 50 retries * 100ms = 5 seconds
  where
    waitForLeader 0 = error $ "Timed out waiting for Kafka leader election on topic: " ++ show name
    waitForLeader retries = do
      ready <- execKafka $ do
        updateMetadata name
        mTmd <- use $ stateTopicMetadata . at name
        case mTmd of
          Nothing -> return False
          Just tmd -> do
            brokers <- use stateBrokers
            let partitions = tmd ^. partitionsMetadata
                leaderIds = map (\p -> p ^. partitionMetadataLeader) partitions
                hasPartitions = not (null partitions)
                allLeadersAssigned = all (\l -> isJust (l ^. leaderId)) leaderIds
                allBrokersExist = all (\l -> M.member l brokers) leaderIds
            return (hasPartitions && allLeadersAssigned && allBrokersExist)
      if ready
        then return ()
        else do
          liftIO $ threadDelay 100000  -- 100ms
          waitForLeader (retries - 1)

-- | Create a broadcast-only topic. For Kafka, same as createTopicAndWait since Kafka retains messages.
createBroadcastTopic :: HasStreaming m => TopicName -> m ()
createBroadcastTopic = createTopicAndWait
