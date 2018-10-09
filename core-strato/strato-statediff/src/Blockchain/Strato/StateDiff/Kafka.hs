module Blockchain.Strato.StateDiff.Kafka
    ( stateDiffTopicName
    , assertTopicCreation
    , writeActionJSONToKafka
    , filterResponse
    ) where

import           Control.Lens.Getter               (view)
import           Data.Aeson
import qualified Data.ByteString.Lazy              as L
import qualified Network.Kafka                     as K
import qualified Network.Kafka.Producer            as KW
import qualified Network.Kafka.Protocol            as KP

import           Blockchain.Data.Action
import           Blockchain.KafkaTopics            (lookupTopic)

stateDiffTopicName :: KP.TopicName
stateDiffTopicName = lookupTopic "statediff"

assertTopicCreation :: K.Kafka k => k ()
assertTopicCreation = K.updateMetadata stateDiffTopicName

mkTopicAndMessage :: (ToJSON a) => a -> K.TopicAndMessage
mkTopicAndMessage = K.TopicAndMessage stateDiffTopicName . KW.makeMessage . L.toStrict . encode

writeActionJSONToKafka :: (K.Kafka k) => [Action] -> k [KP.ProduceResponse]
writeActionJSONToKafka = KW.produceMessages . map mkTopicAndMessage

filterResponse :: [KP.ProduceResponse] -> [(KP.Partition, KP.KafkaError, KP.Offset)]
filterResponse = concatMap onlyErrors
  where onlyErrors :: KP.ProduceResponse -> [(KP.Partition, KP.KafkaError, KP.Offset)]
        onlyErrors resp = let errs = concatMap snd . view KP.produceResponseFields $ resp
                              isError (_, e, _) = e /= KP.NoError
                          in filter isError errs
