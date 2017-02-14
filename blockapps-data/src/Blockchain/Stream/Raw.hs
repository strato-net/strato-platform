{-# LANGUAGE OverloadedStrings, FlexibleContexts #-}

module Blockchain.Stream.Raw (
  produceBytes,
  produceBytes',
  fetchBytes,
  fetchBytesIO,
  fetchBytesOneIO,
  setDefaultKafkaState
  ) where

import Control.Lens
import Control.Monad.IO.Class
import Control.Monad (void)
import qualified Data.ByteString as B

import Network.Kafka
import Network.Kafka.Consumer
import Network.Kafka.Producer
import Network.Kafka.Protocol hiding (Message)

import Blockchain.EthConf
import Blockchain.KafkaTopics


produceBytes :: MonadIO m => String -> [B.ByteString] -> m ()
produceBytes topic items = void . liftIO . runKafkaConfigured "blockapps-data" $ produceBytes' topic items

produceBytes' :: (Kafka k) => String -> [B.ByteString] -> k [ProduceResponse]
produceBytes' topic = produceMessages . fmap (TopicAndMessage (lookupTopic topic) . makeMessage)

fetchBytes :: Kafka k => TopicName -> Offset -> k [B.ByteString]
fetchBytes topic offset = fetchBytes' topic offset >>= (\ts -> return $ snd <$> ts)

fetchBytes' :: Kafka k => TopicName -> Offset -> k [(Offset, B.ByteString)]
fetchBytes' topic offset = do
  fetched <- fetch offset 0 topic
  let datas = (map tamPayload' . fetchMessages) fetched
  return $ zip [offset..] datas

tamPayload' :: TopicAndMessage -> B.ByteString
tamPayload' = foldOf (tamMessage . payload)

fetchBytesIO::TopicName->Offset->IO (Maybe [B.ByteString])
fetchBytesIO topic offset = do
  ret <-
      runKafkaConfigured "blockapps-data" $ do
      lastOffset <- getLastOffset LatestTime 0 topic

      if offset > lastOffset
        then return Nothing
        else setDefaultKafkaState >> Just <$> fetchBytes topic offset

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

setDefaultKafkaState :: Kafka k => k ()
setDefaultKafkaState = do
    stateRequiredAcks .= -1
    stateWaitSize     .= 1
    stateWaitTime     .= 100000