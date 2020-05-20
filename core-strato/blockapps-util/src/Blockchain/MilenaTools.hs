{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}

{-# OPTIONS -fno-warn-redundant-constraints #-}

module Blockchain.MilenaTools where

import           Blockchain.Output
import           Control.Concurrent     (threadDelay)
--import           Control.Lens
import qualified Control.Monad.Change.Modify as Mod
import           Control.Monad.IO.Class      (MonadIO, liftIO)
import           Control.Monad.Except        (ExceptT (..), runExceptT) --, throwError)
import           Control.Monad.Trans.State
import qualified Data.Text                   as T
import           Network.Kafka               hiding (fetchOffset, commitOffset)
import qualified Network.Kafka               as MILENA
import           Network.Kafka.Protocol
import           Prelude


_kMetadata::Metadata->KafkaString
_kMetadata (Metadata x) = x

fetchOffsets :: Kafka m => OffsetFetchRequest -> m OffsetFetchResponse
fetchOffsets = MILENA.fetchOffset
{-
fetchOffsets req@(OffsetFetchReq (group, _)) = do
    coordinator <- getConsumerGroupCoordinator group
    withBrokerHandle coordinator . flip makeRequest $ CGOffsetFetchRR req
-}

commitOffsets :: Kafka m => OffsetCommitRequest -> m OffsetCommitResponse
commitOffsets = MILENA.commitOffset
{-
commitOffsets req@(OffsetCommitReq (group, _, _, _, _)) = do
    coordinator <- getConsumerGroupCoordinator group
    withBrokerHandle coordinator . flip makeRequest $ CGOffsetCommitRR req
-}

fetchSingleOffset :: Kafka m => ConsumerGroup -> TopicName -> Partition -> m (Either KafkaError (Offset, Metadata))
fetchSingleOffset groupName topic partition = do
  let retry = fetchSingleOffset groupName topic partition
  (OffsetFetchResp [(_, [(_, ofs, md, err)])]) <-
    MILENA.fetchOffset $ OffsetFetchReq (groupName, [(topic, [partition])])
    
  case (err, ofs) of
    (NoError, -1)                            -> return $ Left UnknownTopicOrPartition -- todo: stop simulating ZK behavior!
    (NoError, _)                             -> return $ Right (ofs, md)
    (NotCoordinatorForConsumerCode, _)       -> retry
    (ConsumerCoordinatorNotAvailableCode, _) -> retry
    (OffsetsLoadInProgressCode, _)           -> retry
    (err', _)                                -> return $ Left err'

{-
fetchSingleOffset groupName topic partition = do
    let req   = OffsetFetchReq (groupName, [(topic, [partition])])
        retry = fetchSingleOffset groupName topic partition
    (OffsetFetchResp [(_, [(_, ofs, md, err)])]) <- fetchOffsets req
    case (err, ofs) of
        (NoError, -1)                            -> return $ Left UnknownTopicOrPartition -- todo: stop simulating ZK behavior!
        (NoError, _)                             -> return $ Right (ofs, md)
        (NotCoordinatorForConsumerCode, _)       -> retry
        (ConsumerCoordinatorNotAvailableCode, _) -> retry
        (OffsetsLoadInProgressCode, _)           -> retry
        (err', _)                                -> return $ Left err'
-}

commitSingleOffset :: Kafka m => ConsumerGroup -> TopicName -> Partition -> Offset -> Metadata -> m (Either KafkaError ())
commitSingleOffset groupName topic partition offset ofsMetadata = do
  (OffsetCommitResp [(_, [(_, err)])]) <- MILENA.commitOffset $ OffsetCommitReq (groupName, [(topic, [(partition, offset, 0, ofsMetadata)])]) -- todo: handle the empty response (though that probably indicates protocol error)
  return $ if err /= NoError then Left err else Right ()


{-
commitSingleOffset groupName topic partition offset ofsMetadata = do
    let req = OffsetCommitReq (groupName, -1, "", -1, [(topic, [(partition, offset, ofsMetadata)])])
    (OffsetCommitResp [(_, [(_, err)])]) <- commitOffsets req -- todo: handle the empty response (though that probably indicates protocol error)
    return $ if err /= NoError then Left err else Right ()
-}

{-
{-# NOINLINE getConsumerGroupCoordinator #-}
getConsumerGroupCoordinator :: Kafka m => ConsumerGroup -> m Broker
getConsumerGroupCoordinator group = do
    let theReq = CGCoordinatorRR $ GroupCoordinatorReq group
    (GroupCoordinatorResp (err, broker)) <- withAnyHandle $ flip makeRequest theReq
    err & \case
        ConsumerCoordinatorNotAvailableCode -> do  -- coordinator not ready, must retry with backoff
            liftIO $ threadDelay 100000 -- todo something better than threadDelay?
            getConsumerGroupCoordinator group
        NoError -> return broker
        other   -> throwError $ KafkaFailedToFetchGroupCoordinator other
-}

withKafkaRetry :: (MonadIO m, MonadLogger m, Mod.Modifiable KafkaState m) => Int -> StateT KafkaState (ExceptT KafkaClientError IO) a -> m a
withKafkaRetry t k = do
  s <- Mod.get (Mod.Proxy @KafkaState)
  let go = do
        r <- liftIO . runExceptT $ runStateT k s
        case r of
          Right a -> return a
          Left e -> do
            $logErrorS "withKafkaRetry" . T.pack $ show e
            (liftIO $ threadDelay (1000*t)) >> go
  (a, newS) <- go
  Mod.put (Mod.Proxy @KafkaState) newS
  return a

withKafkaRetry1s :: (MonadIO m, MonadLogger m, Mod.Modifiable KafkaState m) => StateT KafkaState (ExceptT KafkaClientError IO) a -> m a
withKafkaRetry1s = withKafkaRetry 1000
