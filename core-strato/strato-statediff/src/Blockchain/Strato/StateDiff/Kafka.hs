module Blockchain.Strato.StateDiff.Kafka
    ( stateDiffTopicName
    , assertTopicCreation
    , writeAnyTypeWithAToJSONInstanceToKafka
    ) where

import           Data.Aeson
import qualified Data.ByteString.Lazy              as L
import qualified Network.Kafka                     as K
import qualified Network.Kafka.Producer            as KW
import qualified Network.Kafka.Protocol            as KP

import           Blockchain.KafkaTopics            (lookupTopic)

stateDiffTopicName :: KP.TopicName
stateDiffTopicName = lookupTopic "statediff"

assertTopicCreation :: K.Kafka k => k ()
assertTopicCreation = K.updateMetadata stateDiffTopicName

mkTopicAndMessage :: (ToJSON a) => a -> K.TopicAndMessage
mkTopicAndMessage = K.TopicAndMessage stateDiffTopicName . KW.makeMessage . L.toStrict . encode

writeAnyTypeWithAToJSONInstanceToKafka :: (ToJSON a, K.Kafka k) => [a] -> k [KP.ProduceResponse]
writeAnyTypeWithAToJSONInstanceToKafka = KW.produceMessages . map mkTopicAndMessage
