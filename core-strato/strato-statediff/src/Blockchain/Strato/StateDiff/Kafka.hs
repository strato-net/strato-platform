module Blockchain.Strato.StateDiff.Kafka
    ( stateDiffTopicName
    , assertTopicCreation
    , filterResponse
    , readStateDiffEvents
    , readStateDiffEventsFromTopic
    , writeStateDiffEvents
    , writeStateDiffs
    , writeAnyTypeWithAToJSONInstanceToKafka
    , splitWriteStateDiffs
    , splitWriteStateDiffEvents
    ) where

import           Control.Lens.Getter               (view)
import           Control.Monad                     (liftM)
import           Data.Aeson
import qualified Data.ByteString.Lazy              as L
import qualified Data.Map                          as Map
import qualified Network.Kafka                     as K
import qualified Network.Kafka.Producer            as KW
import qualified Network.Kafka.Protocol            as KP

import           Blockchain.KafkaTopics            (lookupTopic)

import           Blockchain.Strato.StateDiff
import           Blockchain.Strato.StateDiff.Event

stateDiffTopicName :: KP.TopicName
stateDiffTopicName = lookupTopic "statediff"

assertTopicCreation :: K.Kafka k => k ()
assertTopicCreation = K.updateMetadata stateDiffTopicName

readStateDiffEvents :: K.Kafka k => KP.Offset -> k [StateDiffKafkaEvent]
readStateDiffEvents = readStateDiffEventsFromTopic stateDiffTopicName

readStateDiffEventsFromTopic :: K.Kafka k => KP.TopicName -> KP.Offset -> k [StateDiffKafkaEvent]
--readStateDiffEventsFromTopic topic offset = setDefaultKafkaState >> map (decode . L.fromStrict) <$> fetchBytes topic offset
readStateDiffEventsFromTopic = undefined

mkTopicAndMessage :: (ToJSON a) => a -> K.TopicAndMessage
mkTopicAndMessage = K.TopicAndMessage stateDiffTopicName . KW.makeMessage . L.toStrict . encode

writeStateDiffEvents :: K.Kafka k => [StateDiffEvent] -> k [KP.ProduceResponse]
writeStateDiffEvents = KW.produceMessages . map mkTopicAndMessage

writeStateDiffs :: K.Kafka k => [StateDiff] -> k [KP.ProduceResponse]
writeStateDiffs = KW.produceMessages . map mkTopicAndMessage

writeAnyTypeWithAToJSONInstanceToKafka :: (ToJSON a, K.Kafka k) => [a] -> k [KP.ProduceResponse]
writeAnyTypeWithAToJSONInstanceToKafka = KW.produceMessages . map mkTopicAndMessage

-- splitWriteStateDiffs is useful if there is a statediff that is over 1MB on the wire,
-- as the broker will reject it.
--
splitWriteStateDiffEvents :: K.Kafka k => ([StateDiffEvent], [StateDiffEvent], [StateDiffEvent]) -> k [KP.ProduceResponse]
splitWriteStateDiffEvents (ds, cs, us) = liftM concat . mapM writeStateDiffEvents . map (:[]) $ ds ++ cs ++ us

splitWriteStateDiffs :: K.Kafka k => [StateDiff] -> k [KP.ProduceResponse]
splitWriteStateDiffs = liftM concat . mapM writeStateDiffEvents . map (:[]) . concat . map breakup
  where breakup :: StateDiff -> [StateDiffEvent]
        breakup StateDiff{..} = (Map.elems . Map.mapWithKey (CreationEvent chainId)) createdAccounts
                             ++ (Map.elems . Map.mapWithKey (UpdateEvent chainId)) updatedAccounts
                             ++ (Map.elems . Map.mapWithKey (DeletionEvent chainId)) deletedAccounts

filterResponse :: [KP.ProduceResponse] -> [(KP.Partition, KP.KafkaError, KP.Offset)]
filterResponse = concatMap onlyErrors
  where onlyErrors :: KP.ProduceResponse -> [(KP.Partition, KP.KafkaError, KP.Offset)]
        onlyErrors resp = let errs = concatMap snd . view KP.produceResponseFields $ resp
                              isError (_, e, _) = e /= KP.NoError
                          in filter isError errs
