{-# LANGUAGE OverloadedStrings, FlexibleContexts, LambdaCase #-}

module Network.Kafka.Consumer where

import Control.Applicative
import Control.Lens
import Control.Monad.Except (throwError)
import Control.Monad.IO.Class
import System.IO
import Prelude

import Network.Kafka
import Network.Kafka.Protocol

import Control.Concurrent (threadDelay)

import Debug.Trace (trace)

-- * Fetching

-- | Default: @-1@
ordinaryConsumerId :: ReplicaId
ordinaryConsumerId = ReplicaId (-1)

-- | Construct a fetch request from the values in the state.
fetchRequest :: Offset -> Partition -> TopicName -> Kafka FetchRequest
fetchRequest o p topic = do
  wt <- use stateWaitTime
  ws <- use stateWaitSize
  bs <- use stateBufferSize
  return $ FetchReq (ordinaryConsumerId, wt, ws, [(topic, [(p, o, bs)])])

-- | Execute a fetch request and get the raw fetch response.
fetch' :: Handle -> FetchRequest -> Kafka FetchResponse
fetch' h request = makeRequest h $ FetchRR request

fetch :: Offset -> Partition -> TopicName -> Kafka FetchResponse
fetch o p topic = do
  broker <- getTopicPartitionLeader topic p
  withBrokerHandle broker (\handle -> fetch' handle =<< fetchRequest o p topic)

-- | Extract out messages with their topics from a fetch response.
fetchMessages :: FetchResponse -> [TopicAndMessage]
fetchMessages fr = (fr ^.. fetchResponseFields . folded) >>= tam
    where tam a = TopicAndMessage (a ^. _1) <$> a ^.. _2 . folded . _4 . messageSetMembers . folded . setMessage

fetchOffsets :: OffsetFetchRequest -> Kafka OffsetFetchResponse
fetchOffsets req@(OffsetFetchReq (group, _)) = do
    coordinator <- getConsumerGroupCoordinator group
    withBrokerHandle coordinator . flip makeRequest $ CGOffsetFetchRR req

commitOffsets :: OffsetCommitRequest -> Kafka OffsetCommitResponse
commitOffsets req@(OffsetCommitReq (group, _)) = do
    coordinator <- getConsumerGroupCoordinator group
    withBrokerHandle coordinator . flip makeRequest $ CGOffsetCommitRR req

fetchSingleOffset :: ConsumerGroup -> TopicName -> Partition -> Kafka (Either KafkaError (Offset, Metadata))
fetchSingleOffset groupName topic partition = do
    let req = OffsetFetchReq (groupName, [(topic, [partition])])
    (OffsetFetchResp [(_, [(_, ofs, md, err)])]) <- fetchOffsets req
    return $ if err /= NoError then Left err else Right (ofs, md)

commitSingleOffset :: ConsumerGroup -> TopicName -> Partition -> Offset -> Time -> Metadata -> Kafka (Either KafkaError ())
commitSingleOffset groupName topic partition offset time ofsMetadata = do
    let req = OffsetCommitReq (groupName, [(topic, [(partition, offset, time, ofsMetadata)])])
    (OffsetCommitResp [(_, [(_, err)])]) <- commitOffsets req
    return $ if err /= NoError then Left err else Right ()

{-# NOINLINE getConsumerGroupCoordinator #-}
getConsumerGroupCoordinator :: ConsumerGroup -> Kafka Broker
getConsumerGroupCoordinator group = do
    let theReq = CGCoordinatorRR $ GroupCoordinatorReq group
    (GroupCoordinatorResp (err, broker)) <- withAnyHandle $ flip makeRequest theReq
    err & \case
        ConsumerCoordinatorNotAvailableCode -> do  -- coordinator not ready, must retry with backoff
            liftIO $ threadDelay 100000 -- todo something better than threadDelay?
            getConsumerGroupCoordinator group
        NoError -> return broker
        other   -> throwError $ KafkaFailedToFetchGroupCoordinator other
