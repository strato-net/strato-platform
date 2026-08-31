{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeSynonymInstances #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}

-- | Kafka streaming backend using hw-kafka-client (librdkafka wrapper).
-- More performant than Milena-based kafka-monad.

module Control.Monad.Composable.Streaming.Kafka (
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
  -- Deprecated/internal (for migration)
  KafkaM,
  HasKafka,
  KafkaEnv,
  KafkaClientId,
  KafkaAddress,
  Offset(..),
  ProduceResponse(..),
  runKafkaM,
  runKafkaMUsingEnv,
  createKafkaEnv,
  getKafkaEnv,
  getLatestOffset
  ) where

import Conduit
import Control.Concurrent (threadDelay)
import Control.Exception (bracket)
import Control.Monad (forM_, void)
import Control.Monad.Composable.Base
import Control.Monad.Reader
import qualified Data.Aeson as JSON
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.IORef
import Data.Int (Int64)
import qualified Data.Map.Strict as Map
import Data.Maybe (mapMaybe)
import Data.Text (Text)
import qualified Data.Text as T
import System.Random (randomRIO)
import qualified Kafka.Consumer as KC
import qualified Kafka.Producer as KP
import Kafka.Types (BrokerAddress(..), TopicName(..), KafkaLogLevel(..))

newtype Offset = Offset { unOffset :: Int64 }
  deriving (Show, Eq, Ord, Read)

instance Num Offset where
  (Offset a) + (Offset b) = Offset (a + b)
  (Offset a) * (Offset b) = Offset (a * b)
  abs (Offset a) = Offset (abs a)
  signum (Offset a) = Offset (signum a)
  fromInteger = Offset . fromInteger
  negate (Offset a) = Offset (negate a)

instance Enum Offset where
  toEnum = Offset . toEnum
  fromEnum (Offset a) = fromEnum a

instance Real Offset where
  toRational (Offset a) = toRational a

instance Integral Offset where
  quotRem (Offset a) (Offset b) = let (q, r) = quotRem a b in (Offset q, Offset r)
  toInteger (Offset a) = toInteger a

data ProduceResponse = ProduceResponse
  deriving (Show, Eq)

-- Generic type aliases
type ClientId = Text
type StreamAddress = (String, Int)
type ConsumerGroup = Text

-- Deprecated aliases
type KafkaClientId = ClientId
type KafkaAddress = StreamAddress

type StreamM = ReaderT (IORef StreamEnv)
type HasStreaming m = (MonadIO m, AccessibleEnv (IORef StreamEnv) m)

-- Deprecated aliases
type KafkaM = StreamM
type HasKafka m = HasStreaming m
type KafkaEnv = StreamEnv

data StreamEnv = StreamEnv
  { seProducer    :: KP.KafkaProducer
  , seBroker      :: Text
  , seClientId    :: Text
  }

createStreamEnv :: MonadIO m => ClientId -> StreamAddress -> m StreamEnv
createStreamEnv clientId (host, port) = do
  let broker = T.pack host <> ":" <> T.pack (show port)
      props = KP.brokersList [BrokerAddress broker]
           <> KP.logLevel KafkaLogErr
           <> KP.extraProps (Map.singleton "client.id" clientId)
  result <- liftIO $ KP.newProducer props
  case result of
    Left err -> error $ "Failed to create Kafka producer: " ++ show err
    Right prod -> return $ StreamEnv prod broker clientId

-- Deprecated alias
createKafkaEnv :: MonadIO m => KafkaClientId -> KafkaAddress -> m StreamEnv
createKafkaEnv = createStreamEnv

getStreamEnv :: HasStreaming m => m StreamEnv
getStreamEnv = do
  ref <- accessEnv
  liftIO $ readIORef ref

-- Deprecated alias
getKafkaEnv :: HasStreaming m => m StreamEnv
getKafkaEnv = getStreamEnv

runStreamMUsingEnv :: MonadIO m => StreamEnv -> StreamM m a -> m a
runStreamMUsingEnv env f = do
  ref <- liftIO $ newIORef env
  runReaderT f ref

-- Deprecated alias
runKafkaMUsingEnv :: MonadIO m => StreamEnv -> StreamM m a -> m a
runKafkaMUsingEnv = runStreamMUsingEnv

runStreamM :: MonadUnliftIO m => ClientId -> StreamAddress -> StreamM m a -> m a
runStreamM x y f = flip runStreamMUsingEnv f =<< createStreamEnv x y

-- Deprecated alias
runKafkaM :: MonadUnliftIO m => KafkaClientId -> KafkaAddress -> StreamM m a -> m a
runKafkaM = runStreamM

----------------------
--    Producing     --
----------------------

mkRecord :: TopicName -> Maybe B.ByteString -> KP.ProducerRecord
mkRecord topic val = KP.ProducerRecord
  { KP.prTopic = topic
  , KP.prPartition = KP.UnassignedPartition
  , KP.prKey = Nothing
  , KP.prValue = val
  , KP.prHeaders = mempty
  }

produceItems :: (Binary a, HasStreaming m) => TopicName -> [a] -> m [ProduceResponse]
produceItems topicName events = do
  env <- getStreamEnv
  let producer = seProducer env
  forM_ events $ \e -> do
    mErr <- liftIO $ KP.produceMessage producer (mkRecord topicName (Just . BL.toStrict $ encode e))
    case mErr of
      Just err -> error $ "Kafka produce error: " ++ show err
      Nothing -> return ()
  liftIO $ KP.flushProducer producer
  return [ProduceResponse]

-- | Produce already-encoded payloads to several topics, flushing once.
--
-- 'produceItems' flushes per call, so a caller writing two topics per unit of
-- work blocks on two flushes. Enqueueing everything first and flushing once
-- lets librdkafka batch the lot.
--
-- Callers encode their own payloads because the topics generally carry
-- different types.
produceToTopics :: HasStreaming m => [(TopicName, [B.ByteString])] -> m [ProduceResponse]
produceToTopics groups = do
  env <- getStreamEnv
  let producer = seProducer env
  forM_ groups $ \(topicName, raws) ->
    forM_ raws $ \raw -> do
      mErr <- liftIO $ KP.produceMessage producer (mkRecord topicName (Just raw))
      case mErr of
        Just err -> error $ "Kafka produce error: " ++ show err
        Nothing -> return ()
  liftIO $ KP.flushProducer producer
  return [ProduceResponse]

produceItemsAsJSON :: (JSON.ToJSON a, HasStreaming m) => TopicName -> [a] -> m [ProduceResponse]
produceItemsAsJSON topicName events = do
  env <- getStreamEnv
  let producer = seProducer env
  forM_ events $ \e -> do
    mErr <- liftIO $ KP.produceMessage producer (mkRecord topicName (Just . BL.toStrict $ JSON.encode e))
    case mErr of
      Just err -> error $ "Kafka produce error: " ++ show err
      Nothing -> return ()
  liftIO $ KP.flushProducer producer
  return [ProduceResponse]

----------------------
--Consuming/Fetching--
----------------------

mkConsumerProps :: StreamEnv -> Text -> KC.ConsumerProperties
mkConsumerProps env grpId =
  KC.brokersList [BrokerAddress (seBroker env)]
  <> KC.groupId (KC.ConsumerGroupId grpId)
  <> KC.noAutoCommit
  <> KC.logLevel KafkaLogErr
  <> KC.extraProps (Map.fromList
       [ ("enable.partition.eof", "true")
       , ("client.id", seClientId env <> "-" <> grpId)
       , ("fetch.wait.max.ms", "50000")
       , ("fetch.min.bytes", "1")
       ])

uniqueGroupId :: Text -> IO Text
uniqueGroupId prefix = do
  n <- randomRIO (100000 :: Int, 999999)
  return $ prefix <> "-" <> T.pack (show n)

mkConsumerSub :: TopicName -> KC.Subscription
mkConsumerSub topic = KC.topics [topic] <> KC.offsetReset KC.Earliest

newConsumerAt :: StreamEnv -> Text -> TopicName -> Offset -> IO KC.KafkaConsumer
newConsumerAt env grpId topicName (Offset ofs) = do
  result <- KC.newConsumer (mkConsumerProps env grpId) (mkConsumerSub topicName)
  case result of
    Left err -> error $ "Failed to create Kafka consumer: " ++ show err
    Right kc -> do
      let tp = KC.TopicPartition topicName (KC.PartitionId 0) (KC.PartitionOffset ofs)
      mErr <- KC.assign kc [tp]
      case mErr of
        Nothing -> return kc
        Just err -> error $ "Kafka assign error: " ++ show err

consume :: (Binary a, HasStreaming m) =>
           ConsumerGroup -> TopicName -> ([a] -> m ()) -> m ()
consume consumerGroup topicName f =
  void $ runConsume consumerGroup topicName (\a -> Nothing <$ f a)

-- | Pub-sub consume. For Kafka, same as consume since consumer groups provide pub-sub.
consumeBroadcast :: (Binary a, HasStreaming m) =>
                    ConsumerGroup -> TopicName -> ([a] -> m ()) -> m ()
consumeBroadcast = consume

runConsume :: (Binary a, HasStreaming m) =>
              ConsumerGroup -> TopicName -> ([a] -> m (Maybe b)) -> m b
runConsume consumerGroup topicName f = do
  env <- getStreamEnv
  kc <- liftIO $ do
    consumer <- newConsumerAt env consumerGroup topicName (Offset 0)
    offset <- getCommittedOffset consumer topicName
    let tp = KC.TopicPartition topicName (KC.PartitionId 0) (KC.PartitionOffset $ unOffset offset)
    mErr <- KC.assign consumer [tp]
    case mErr of
      Nothing -> return consumer
      Just err -> error $ "Kafka assign error: " ++ show err
  consumeLoop kc
  where
    consumeLoop kc = do
      (items, newOffset) <- pollItems kc
      mReturnVal <- f items
      liftIO $ commitOffset kc topicName newOffset
      case mReturnVal of
        Just returnVal -> do
          liftIO $ void $ KC.closeConsumer kc
          pure returnVal
        Nothing -> consumeLoop kc

    pollItems kc = do
      msgs <- liftIO $ KC.pollMessageBatch kc (KC.Timeout 50000) (KC.BatchSize 500)
      let records = mapMaybe extractPayload msgs
          payloads = map snd records
      if null payloads
        then pollItems kc
        else return (map (decode . BL.fromStrict) payloads, nextOffset records)

    extractPayload (Left _) = Nothing
    extractPayload (Right cr) = (\v -> (cr, v)) <$> KC.crValue cr

    nextOffset records =
      Offset . (+ 1) . maximum $ map (recordOffset . fst) records

    recordOffset cr =
      case KC.crOffset cr of
        KC.Offset n -> n

getCommittedOffset :: KC.KafkaConsumer -> TopicName -> IO Offset
getCommittedOffset kc topicName = do
  eOffsets <- KC.committed kc (KC.Timeout 5000) [(topicName, KC.PartitionId 0)]
  case eOffsets of
    Left err -> error $ "Kafka committed offset error: " ++ show err
    Right [tp] ->
      case KC.tpOffset tp of
        KC.PartitionOffset n -> return $ Offset n
        _ -> return $ Offset 0
    _ -> return $ Offset 0

commitOffset :: KC.KafkaConsumer -> TopicName -> Offset -> IO ()
commitOffset kc topicName (Offset ofs) = do
  let tp = KC.TopicPartition topicName (KC.PartitionId 0) (KC.PartitionOffset ofs)
  mErr <- KC.commitPartitionsOffsets KC.OffsetCommit kc [tp]
  case mErr of
    Nothing -> return ()
    Just err -> error $ "Kafka offset commit error: " ++ show err

consumeFromLatest :: (Binary a, HasStreaming m) =>
                     TopicName -> m () -> ([a] -> m (Maybe b)) -> m b
consumeFromLatest topicName initAction f = do
  startOffset <- getLatestOffset topicName
  initAction
  env <- getStreamEnv
  kc <- liftIO $ newConsumerAt env (seClientId env <> "-latest") topicName startOffset
  consumeLoop kc
  where
    consumeLoop kc = do
      items <- pollItems kc
      result <- f items
      case result of
        Just val -> do
          liftIO $ void $ KC.closeConsumer kc
          return val
        Nothing -> consumeLoop kc

    pollItems kc = do
      msgs <- liftIO $ KC.pollMessageBatch kc (KC.Timeout 50000) (KC.BatchSize 500)
      let payloads = mapMaybe extractPayload msgs
      return $ map (decode . BL.fromStrict) payloads

    extractPayload (Left _) = Nothing
    extractPayload (Right cr) = KC.crValue cr

getLatestOffset :: HasStreaming m => TopicName -> m Offset
getLatestOffset topicName = do
  env <- getStreamEnv
  liftIO $ getLatestOffsetIO env topicName

getLatestOffsetIO :: StreamEnv -> TopicName -> IO Offset
getLatestOffsetIO env topicName =
  bracket mkC (void . KC.closeConsumer) $ \kc -> do
    let tp = KC.TopicPartition topicName (KC.PartitionId 0) KC.PartitionOffsetEnd
    mErr <- KC.assign kc [tp]
    case mErr of
      Just err -> error $ "Kafka assign error in getLatestOffset: " ++ show err
      Nothing -> do
        _ <- KC.seekPartitions kc [tp] (KC.Timeout 5000)
        ePositions <- KC.position kc [(topicName, KC.PartitionId 0)]
        case ePositions of
          Right [tp'] -> case KC.tpOffset tp' of
            KC.PartitionOffset n -> return (Offset n)
            _ -> return (Offset 0)
          _ -> return (Offset 0)
  where
    mkC = do
      gid <- uniqueGroupId (seClientId env <> "-offset")
      result <- KC.newConsumer (mkConsumerProps env gid) (mkConsumerSub topicName)
      case result of
        Left err -> error $ "Failed to create consumer for offset query: " ++ show err
        Right kc -> return kc

conduitBatchSource :: (MonadIO m, Binary a) =>
                      ClientId -> StreamAddress -> TopicName -> ConduitT i [a] m b
conduitBatchSource clientId streamAddress topicName = do
  env <- createStreamEnv clientId streamAddress
  startingOffset <- liftIO $ getLatestOffsetIO env topicName
  kc <- liftIO $ newConsumerAt env (seClientId env <> "-conduit-batch") topicName startingOffset
  let loop = do
        msgs <- liftIO $ KC.pollMessageBatch kc (KC.Timeout 50000) (KC.BatchSize 500)
        let payloads = mapMaybe extractPayload msgs
            items = map (decode . BL.fromStrict) payloads
        yield items
        loop
  loop
  where
    extractPayload (Left _) = Nothing
    extractPayload (Right cr) = KC.crValue cr

----------------------
--  Topic creation  --
----------------------

createTopic :: HasStreaming m => TopicName -> m ()
createTopic topicName = do
  env <- getStreamEnv
  let producer = seProducer env
  _ <- liftIO $ KP.produceMessage producer (mkRecord topicName Nothing)
  liftIO $ KP.flushProducer producer

createTopicAndWait :: HasStreaming m => TopicName -> m ()
createTopicAndWait topicName = do
  createTopic topicName
  waitForReady (50 :: Int)
  where
    waitForReady 0 = error $ "Timed out waiting for Kafka topic: " ++ show topicName
    waitForReady retries = do
      env <- getStreamEnv
      ready <- liftIO $ checkTopicReady env topicName
      if ready
        then return ()
        else do
          liftIO $ threadDelay 100000
          waitForReady (retries - 1)

-- | Create a broadcast-only topic. For Kafka, same as createTopicAndWait since Kafka retains messages.
createBroadcastTopic :: HasStreaming m => TopicName -> m ()
createBroadcastTopic = createTopicAndWait

checkTopicReady :: StreamEnv -> TopicName -> IO Bool
checkTopicReady env topicName =
  bracket mkC (void . KC.closeConsumer) $ \kc -> do
    let tp = KC.TopicPartition topicName (KC.PartitionId 0) KC.PartitionOffsetEnd
    mErr <- KC.assign kc [tp]
    case mErr of
      Nothing -> return True
      Just _ -> return False
  where
    mkC = do
      gid <- uniqueGroupId (seClientId env <> "-topic-check")
      result <- KC.newConsumer (mkConsumerProps env gid) (mkConsumerSub topicName)
      case result of
        Left _ -> error "Failed to create consumer for topic check"
        Right kc -> return kc
