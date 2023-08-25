module Network.Kafka.Consumer where

import Control.Applicative
import Control.Lens
import Data.ByteString (ByteString)
import Data.Maybe
import Network.Kafka
import Network.Kafka.Protocol
import System.IO
import Prelude

-- * Fetching

-- | Default: @-1@
ordinaryConsumerId :: ReplicaId
ordinaryConsumerId = ReplicaId (-1)

-- | Construct a fetch request from the values in the state.
fetchRequest :: Kafka m => Offset -> Partition -> TopicName -> m FetchRequest
fetchRequest o p topic = do
  wt <- use stateWaitTime
  ws <- use stateWaitSize
  bs <- use stateBufferSize
  return $ FetchReq (ordinaryConsumerId, wt, ws, [(topic, [(p, o, bs)])])

-- | Execute a fetch request and get the raw fetch response.
fetch' :: Kafka m => Handle -> FetchRequest -> m FetchResponse
fetch' h request = makeRequest h $ FetchRR request

fetch :: Kafka m => Offset -> Partition -> TopicName -> m FetchResponse
fetch o p topic = do
  broker <- getTopicPartitionLeader topic p
  withBrokerHandle broker (\handle -> fetch' handle =<< fetchRequest o p topic)

-- | Extract out messages with their topics from a fetch response.

-- fetchMessages is deprecated.  This will only return messages in the older version (magic byte = 0), and misses messages in the new format (magic byte = 2, record batches)
fetchMessages :: FetchResponse -> [TopicAndMessage]
fetchMessages fr = (fr ^.. fetchResponseFields . folded) >>= tam
  where
    tam a = TopicAndMessage (a ^. _1) <$> a ^.. _2 . folded . _4 . messageSetMembers . folded . setMessage

--RecordBatches can contain messages lower than the requested offset, so we need to
--supply the requested offsets so that we know which values to ignore
fetchResponseToPayload :: [Offset] -> FetchResponse -> [ByteString]
fetchResponseToPayload [offset] res =
  concat . map (messageSetToPayload offset) $ res ^.. fetchResponseFields . folded . _2 . folded . _4
fetchResponseToPayload _ _ = error "fetchResponseToPayload doesn't support requests from multiple topics"

messageSetToPayload :: Offset -> MessageSet -> [ByteString]
messageSetToPayload _ MessageSet {_messageSetMembers = msms} =
  map (^. setMessage . messageFields . _5 . valueBytes . folded . kafkaByteString) msms
messageSetToPayload requestedOffset RecordBatch {_records = rs, _firstOffset = firstReturnedOffset} =
  let allPayloads = map (_kafkaByteString . fromMaybe (error "deformed kafka message, message is NULL") . _value) rs
   in if length allPayloads < fromIntegral (requestedOffset - firstReturnedOffset)
        then error $ "fetchBytes': missing messages: # messages returned: " ++ show (length allPayloads) ++ ", offset=" ++ show requestedOffset ++ ", firstReturnedOffset=" ++ show firstReturnedOffset
        else drop (fromIntegral $ requestedOffset - firstReturnedOffset) allPayloads
