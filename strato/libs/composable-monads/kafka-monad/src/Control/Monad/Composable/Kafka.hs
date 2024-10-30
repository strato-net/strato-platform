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
  KafkaM,
  HasKafka,
  KafkaEnv(..),
  TopicName,
  kafkaStateToKafkaEnv,
  runKafkaM,
  runKafkaMUsingEnv,
  execKafka,
  commitSingleOffset,
  fetchSingleOffset,
  produceItems,
  produceItemsAsJSON,
  consume,
  runConsume,
  fetchItems,
  KafkaString(..),
  KafkaAddress,
  KafkaClientId,
  Offset,
  Metadata(..),
  ConsumerGroup,
  KafkaError(..),
  ProduceResponse,
  packMetadata,
  unpackMetadata,
  conduitSource,
  conduitSourceUsingEnv,
  conduitBatchSource,
  conduitBatchSourceUsingEnv,
  createKafkaEnv,
  createTopic
  ) where

import BlockApps.Logging
import Blockchain.MilenaTools
import Conduit
import Control.Lens
import Control.Monad (forM_, void)
import Control.Monad.Composable.Base
import Control.Monad.Loops
import Control.Monad.Reader
import Control.Monad.Trans.Except
import Control.Monad.Trans.State
import qualified Data.Aeson as JSON
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.IORef
import Data.List
import Data.Text (Text)
import qualified Data.Text as T
import Network.Kafka hiding (createTopic)
import qualified Network.Kafka as Milena
import Network.Kafka.Consumer
import Network.Kafka.Producer
import Network.Kafka.Protocol



type KafkaM = ReaderT (IORef KafkaState)

type HasKafka m = (MonadIO m, AccessibleEnv (IORef KafkaState) m)

data KafkaEnv = KafkaEnv
  { kafkaStateIORef :: IORef KafkaState
  }

createKafkaEnv ::
  MonadIO m =>
  KafkaClientId ->
  KafkaAddress ->
  m KafkaEnv
createKafkaEnv x y = do
  let kafkaState =
        (mkKafkaState x y)
          { _stateRequiredAcks = -1,
            _stateWaitSize = 1, -- Awaken from sleep only if there is at least one message
            _stateWaitTime = 100000 -- 100s
          }

  kafkaStateToKafkaEnv kafkaState

kafkaStateToKafkaEnv :: MonadIO m =>
                        KafkaState -> m KafkaEnv
kafkaStateToKafkaEnv kafkaState = do
  ksIORef <- liftIO $ newIORef kafkaState
  return $ KafkaEnv ksIORef

runKafkaMUsingEnv :: KafkaEnv -> KafkaM m a -> m a
runKafkaMUsingEnv env f =
  runReaderT f $ kafkaStateIORef env

runKafkaM :: MonadIO m => KafkaClientId -> KafkaAddress -> KafkaM m a -> m a
runKafkaM x y f = flip runKafkaMUsingEnv f =<< createKafkaEnv x y

execKafka ::
  HasKafka m =>
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


unpackMetadata :: Binary a =>
                  Metadata -> a
unpackMetadata = decode . BL.fromStrict . either (error "error in unpackMetadata, data is not valid base 16 encoded") id . B16.decode . _kString . _kMetadata

packMetadata :: Binary a =>
                a -> Metadata
packMetadata = Metadata . KString . B16.encode . BL.toStrict . encode

----------------------
--   Checkpoints    --
----------------------

getKafkaCheckpoint :: (MonadLogger m, HasKafka m) =>
                      ConsumerGroup -> TopicName -> m (Offset, Metadata)
getKafkaCheckpoint consumerGroup topicName =
  execKafka (fetchSingleOffset consumerGroup topicName 0) >>= \case
    Left UnknownTopicOrPartition -> do
      let md' = ""
          theOffset = 0
      setKafkaCheckpoint consumerGroup topicName theOffset md'
      return (theOffset, md')
    Left err -> error $ "Unexpected response when fetching offset for " ++ show consumerGroup ++ ": " ++ show err
    Right (o, md) -> return (o, md)

setKafkaCheckpoint :: (MonadLogger m, HasKafka m) =>
                      ConsumerGroup -> TopicName -> Offset -> Metadata -> m ()
setKafkaCheckpoint consumerGroup topicName ofs md = do
  $logInfoS "setKafkaCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs
  op' <- execKafka $ setKafkaCheckpoint' consumerGroup topicName ofs md
  case op' of
    Left err -> error $ "Client error: " ++ show err
    Right _ -> return ()

setKafkaCheckpoint' :: Kafka k => ConsumerGroup -> TopicName -> Offset -> Metadata -> k (Either KafkaError ())
setKafkaCheckpoint' consumerGroup targetTopicName offset md = commitSingleOffset consumerGroup targetTopicName 0 `flip` md $ offset


----------------------
--    Producing     --
----------------------

produceItems :: (Binary a, HasKafka m) => TopicName -> [a] -> m [ProduceResponse]
produceItems topicName events = do
  results <-
    execKafka $ produceMessagesAsSingletonSets $
      (TopicAndMessage topicName . makeMessage . BL.toStrict . encode) <$> events
  liftIO $ mapM_ parseKafkaResponse results
  return results

produceItemsAsJSON :: (JSON.ToJSON a, HasKafka m) => TopicName -> [a] -> m [ProduceResponse]
produceItemsAsJSON topicName events = do
  results <-
    execKafka $ produceMessagesAsSingletonSets $
      (TopicAndMessage topicName . makeMessage . BL.toStrict . JSON.encode) <$> events
  liftIO $ mapM_ parseKafkaResponse results
  return results

----------------------
--Consuming/Fetching--
----------------------

consume :: (Binary a, Binary md, MonadLogger m, HasKafka m) =>
           Text -> ConsumerGroup -> TopicName -> (md -> [a] -> m md) -> m ()
consume name consumerGroup topicName f = void $ runConsume name consumerGroup topicName (\md a -> (Nothing :: Maybe Void,) <$> f md a)

runConsume :: (Binary a, Binary md, MonadLogger m, HasKafka m) =>
              Text -> ConsumerGroup -> TopicName -> (md -> [a] -> m (Maybe b, md)) -> m b
runConsume name consumerGroup topicName f = consumeOnce
  where
    consumeOnce = do
      $logInfoS name "About to fetch blocks"
      (offset, md) <- getKafkaCheckpoint consumerGroup topicName
      items <- fetchItems topicName offset
      $logInfoS name . T.pack $ "Fetched " ++ show (length items) ++ " events starting from " ++ show offset
      (mReturnVal, md') <- f (unpackMetadata md) items
      let nextOffset' = offset + fromIntegral (length items)
      setKafkaCheckpoint consumerGroup topicName nextOffset' $ packMetadata md'
      case mReturnVal of
        Just returnVal -> pure returnVal
        Nothing -> consumeOnce

fetchItems :: (Binary a, HasKafka m) =>
              TopicName -> Offset -> m [a]
fetchItems topicName offset = map (decode . BL.fromStrict) <$> fetchBytes topicName offset

fetchBytes :: HasKafka m => TopicName -> Offset -> m [B.ByteString]
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

conduitSource :: (MonadLogger m, MonadIO m, Binary a) =>
                 LogSource -> KafkaClientId -> KafkaAddress -> TopicName -> ConduitT i a m b
conduitSource name clientId kafkaAddress topicName = do
  env <- createKafkaEnv clientId kafkaAddress

  conduitSourceUsingEnv name env topicName

conduitSourceUsingEnv :: (MonadLogger m, MonadIO m, Binary a) =>
                         LogSource -> KafkaEnv -> TopicName -> ConduitT i a m b
conduitSourceUsingEnv name env topicName = do
  startingOffset <- runKafkaMUsingEnv env $ execKafka $ getLastOffset LatestTime 0 topicName

  flip iterateM_ startingOffset $ \offset -> do
      $logInfoS name "About to fetch blocks"
      items <- runKafkaMUsingEnv env $ fetchItems topicName offset
      $logInfoS name . T.pack $ "Fetched " ++ show (length items) ++ " events starting from " ++ show offset
      forM_ items yield
      return $ offset + fromIntegral (length items)

conduitBatchSource :: (MonadLogger m, MonadIO m, Binary a) =>
                      LogSource -> KafkaClientId -> KafkaAddress -> TopicName -> ConduitT i [a] m b
conduitBatchSource name clientId kafkaAddress topicName = do
  env <- createKafkaEnv clientId kafkaAddress

  conduitBatchSourceUsingEnv name env topicName

conduitBatchSourceUsingEnv :: (MonadLogger m, MonadIO m, Binary a) =>
                              LogSource -> KafkaEnv -> TopicName -> ConduitT i [a] m b
conduitBatchSourceUsingEnv name env topicName = do
  startingOffset <- runKafkaMUsingEnv env $ execKafka $ getLastOffset LatestTime 0 topicName

  flip iterateM_ startingOffset $ \offset -> do
      $logInfoS name "About to fetch blocks"
      items <- runKafkaMUsingEnv env $ fetchItems topicName offset
      $logInfoS name . T.pack $ "Fetched " ++ show (length items) ++ " events starting from " ++ show offset
      yield items
      return $ offset + fromIntegral (length items)

createTopic :: HasKafka m =>
               TopicName -> m ()
createTopic name = do
  TopicsResp result <- execKafka $ Milena.createTopic $ createTopicsRequest name 1 1 [] []
  let errors = filter ((/= NoError) . snd) result
  case errors of
    [] -> return ()
    [(_, TopicAlreadyExists)] -> return () -- No problem, it was already there
    _ -> error $ "Error creating kafka topic " ++ show name ++ ": " ++ show errors
