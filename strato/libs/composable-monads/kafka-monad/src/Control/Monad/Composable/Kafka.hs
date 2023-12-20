{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}

module Control.Monad.Composable.Kafka (
  KafkaM,
  HasKafka,
  KafkaEnv(..),
  runKafkaM,
  runKafkaMUsingEnv,
  execKafka,
  consume,
  produceItems,
  commitSingleOffset,
  fetchSingleOffset,
  KafkaString(..),
  KafkaAddress,
  KafkaClientId,
  Offset,
  Metadata(..),
  ConsumerGroup,
  KafkaError(..)
  ) where

import BlockApps.Logging
import Blockchain.MilenaTools
import Control.Lens
import Control.Monad.Composable.Base
import Control.Monad.IO.Unlift
import Control.Monad.Reader
import Control.Monad.Trans.Except
import Control.Monad.Trans.State
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.IORef
import Data.List
import Data.Text (Text)
import qualified Data.Text as T
import Network.Kafka
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
  KafkaString ->
  KafkaAddress ->
  m KafkaEnv
createKafkaEnv x y = do
  let kafkaState =
        (mkKafkaState x y)
          { _stateRequiredAcks = -1,
            _stateWaitSize = 1, -- Awaken from sleep only if there is at least one message
            _stateWaitTime = 100000 -- 100s
          }

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



readIndexEvents :: (Binary a, Kafka k) => TopicName -> Offset -> k [a]
readIndexEvents topicName = readIndexEventsFromTopic topicName

readIndexEventsFromTopic :: (Binary a, Kafka k) => TopicName -> Offset -> k [a]
readIndexEventsFromTopic topic offset = setDefaultKafkaState >> map (decode . BL.fromStrict) <$> fetchBytes topic offset

produceItems :: (Binary a, HasKafka m) => TopicName -> [a] -> m [ProduceResponse]
produceItems topicName events = do
  results <-
    execKafka $ produceMessagesAsSingletonSets $
      (TopicAndMessage topicName . makeMessage . BL.toStrict . encode) <$> events
  liftIO $ mapM_ parseKafkaResponse results
  return results

consume :: (Binary a, MonadLogger m, HasKafka m) =>
           Text -> ConsumerGroup -> TopicName -> ([a] -> m ()) -> m ()
consume name consumerGroup topicName f = 
  forever $ do
    $logInfoS name "About to fetch blocks"
    (offset, idxEvents) <- fetchItems consumerGroup topicName
    $logInfoS name . T.pack $ "Fetched " ++ show (length idxEvents) ++ " events starting from " ++ show offset
    f idxEvents
    let nextOffset' = offset + fromIntegral (length idxEvents)
    setKafkaCheckpoint consumerGroup topicName nextOffset' ""


getKafkaCheckpoint :: (MonadLogger m, HasKafka m) =>
                      ConsumerGroup -> TopicName -> m Offset
getKafkaCheckpoint consumerGroup topicName =
  execKafka (fetchSingleOffset consumerGroup topicName 0) >>= \case
    Left UnknownTopicOrPartition -> setKafkaCheckpoint consumerGroup topicName 0 "" >> getKafkaCheckpoint consumerGroup topicName
    Left err -> error $ "Unexpected response when fetching offset for " ++ show consumerGroup ++ ": " ++ show err
    Right r -> pure $ fst r

setKafkaCheckpoint :: (MonadLogger m, HasKafka m) =>
                      ConsumerGroup -> TopicName -> Offset -> Metadata -> m ()
setKafkaCheckpoint consumerGroup topicName ofs md = do
  $logInfoS "setKafkaCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs
  op' <- execKafka (setKafkaCheckpoint' consumerGroup topicName ofs md)
  case op' of
    Left err -> error $ "Client error: " ++ show err
    Right _ -> return ()

setKafkaCheckpoint' :: Kafka k => ConsumerGroup -> TopicName -> Offset -> Metadata -> k (Either KafkaError ())
setKafkaCheckpoint' consumerGroup targetTopicName offset md = commitSingleOffset consumerGroup targetTopicName 0 `flip` md $ offset

fetchItems :: (Binary a, MonadLogger m, HasKafka m) =>
              ConsumerGroup -> TopicName -> m (Offset, [a])
fetchItems consumerGroup topicName = do
  ofs <- getKafkaCheckpoint consumerGroup topicName
  evs <- execKafka $ readIndexEvents topicName ofs
  return (ofs, evs)

setDefaultKafkaState :: Kafka k => k ()
setDefaultKafkaState = do
  stateRequiredAcks .= -1
  stateWaitSize .= 1
  stateWaitTime .= 100000

fetchBytes :: Kafka k => TopicName -> Offset -> k [B.ByteString]
fetchBytes topic offset = fetchBytes' topic offset >>= (\ts -> return $ snd <$> ts)

fetchBytes' :: Kafka k => TopicName -> Offset -> k [(Offset, B.ByteString)]
fetchBytes' topic offset = do
  fetched <- fetch offset 0 topic

  let errorStatuses = concat $ map (^.. _2 . folded . _2) (fetched ^. fetchResponseFields)
  --If the Kafka fetch fails, this is a critical error, we have no choice but to halt the program.
  --Also, since the Kafka fetch is typically in a loop, by not halting, we will often create a
  --fast infinite loop that will eat 100% of the CPU and quickly fill up the logs.
  case find (/= NoError) errorStatuses of
    Just e -> error $ "There was a critical Kafka error while fetching messages: " ++ show e ++ "\ntopic = " ++ BC.unpack (topic ^. tName ^. kString) ++ ", offset = " ++ show offset
    _ -> return ()

  return $ zip [offset ..] $ fetchResponseToPayload [offset] fetched

