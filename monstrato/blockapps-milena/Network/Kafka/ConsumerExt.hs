{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE FlexibleContexts  #-}

module Network.Kafka.ConsumerExt where

import           Control.Applicative
import           Control.Lens
import           System.IO
import           Prelude

import           Network.Kafka
import           Network.Kafka.Protocol

import           Control.Monad.Except   (throwError)
import           Control.Monad.IO.Class
import           Control.Concurrent     (threadDelay)

fetchOffsets :: Kafka m => OffsetFetchRequest -> m OffsetFetchResponse
fetchOffsets req@(OffsetFetchReq (group, _)) = do
    coordinator <- getConsumerGroupCoordinator group
    withBrokerHandle coordinator . flip makeRequest $ CGOffsetFetchRR req

commitOffsets :: Kafka m => OffsetCommitRequest -> m OffsetCommitResponse
commitOffsets req@(OffsetCommitReq (group, _, _, _, _)) = do
    coordinator <- getConsumerGroupCoordinator group
    withBrokerHandle coordinator . flip makeRequest $ CGOffsetCommitRR req

fetchSingleOffset :: Kafka m => ConsumerGroup -> TopicName -> Partition -> m (Either KafkaError (Offset, Metadata))
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

commitSingleOffset :: Kafka m => ConsumerGroup -> TopicName -> Partition -> Offset -> Metadata -> m (Either KafkaError ())
commitSingleOffset groupName topic partition offset ofsMetadata = do
    let req = OffsetCommitReq (groupName, -1, "", -1, [(topic, [(partition, offset, ofsMetadata)])])
    (OffsetCommitResp [(_, [(_, err)])]) <- commitOffsets req -- todo: handle the empty response (though that probably indicates protocol error)
    return $ if err /= NoError then Left err else Right ()

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
