{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Stream.Raw
  ( produceBytes,
    fetchBytes,
  )
where

import Control.Lens
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.List
import Network.Kafka
import Network.Kafka.Consumer
import Network.Kafka.Producer
import Network.Kafka.Protocol hiding (Message)

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

  return $ zip [offset ..] $ fetchResponseToPayload [offset] fetched

