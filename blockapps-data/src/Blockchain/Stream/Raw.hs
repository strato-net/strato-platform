{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Stream.Raw (
  produceBytes,
  fetchBytes,
  fetchBytesIO,
  fetchBytesOneIO
  ) where

import Control.Lens
import Control.Monad.IO.Class
import qualified Data.ByteString as B

import Network.Kafka
import Network.Kafka.Consumer
import Network.Kafka.Producer
import Network.Kafka.Protocol hiding (Message)

import Blockchain.EthConf
import Blockchain.KafkaTopics

produceBytes::MonadIO m=>String->[B.ByteString]->m ()
produceBytes topic items = do
  _ <- liftIO $ runKafkaConfigured "blockapps-data" $
    produceMessages $ map (TopicAndMessage (lookupTopic topic) . makeMessage) items
  return ()

fetchBytes::TopicName->Offset->Kafka [B.ByteString]
fetchBytes topic offset = do
  fetched <- fetch offset 0 topic
  let datas = (map tamPayload' . fetchMessages) $ fetched
  return datas

tamPayload' :: TopicAndMessage -> B.ByteString
tamPayload' = foldOf (tamMessage . payload)

fetchBytesIO::TopicName->Offset->IO (Maybe [B.ByteString])
fetchBytesIO topic offset = do
  ret <-
      runKafkaConfigured "blockapps-data" $ do
      lastOffset <- getLastOffset LatestTime 0 topic

      if (offset > lastOffset)
        then return Nothing
        else do
          stateRequiredAcks .= -1
          stateWaitSize .= 1
          stateWaitTime .= 100000
          fmap Just $ fetchBytes topic offset


  case ret of
   Left e -> error $ show e
   Right v -> return v
              
fetchBytesOneIO::TopicName->Offset->IO (Maybe B.ByteString)
fetchBytesOneIO topic offset = do
  res <- fetchBytesIO topic offset
  case res of
   Nothing -> return Nothing
   Just (x:_) -> return $ Just x
   Just [] -> error "something impossible happened in fetchBytesOneIO"              
