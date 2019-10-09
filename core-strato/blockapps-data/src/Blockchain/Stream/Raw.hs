{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Stream.Raw (
  produceBytes,
  fetchBytes,
  fetchBytesIO,
  fetchBytesOneIO,
  setDefaultKafkaState
  ) where

import           Control.Lens
import qualified Data.ByteString        as B
import qualified Data.ByteString.Char8  as BC
import           Data.List

import           Network.Kafka
import           Network.Kafka.Consumer
import           Network.Kafka.Producer
import           Network.Kafka.Protocol hiding (Message)

import           Blockchain.EthConf


produceBytes :: (Kafka k) => TopicName -> [B.ByteString] -> k [ProduceResponse]
produceBytes topic = produceMessages . fmap (TopicAndMessage topic . makeMessage)

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
   Left e  -> error $ show e
   Right v -> return v

fetchBytesOneIO::TopicName->Offset->IO (Maybe B.ByteString)
fetchBytesOneIO topic offset = do
  res <- fetchBytesIO topic offset
  case res of
   Nothing    -> return Nothing
   Just (x:_) -> return $ Just x
   Just []    -> error "something impossible happened in fetchBytesOneIO"

setDefaultKafkaState :: Kafka k => k ()
setDefaultKafkaState = do
    stateRequiredAcks .= -1
    stateWaitSize     .= 1
    stateWaitTime     .= 100000
