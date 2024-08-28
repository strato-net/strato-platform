module Blockchain.Strato.StateDiff.Kafka
  ( stateDiffTopicName,
    assertStateDiffTopicCreation,
    --    , writeActionJSONToKafka
    filterResponse,
  )
where

--import           Data.Aeson
--import qualified Data.ByteString.Lazy              as L

--import qualified Network.Kafka.Producer            as KW

--import           Blockchain.Strato.Model.Action    (Action)
import Blockchain.KafkaTopics (lookupTopic)
import Control.Lens.Getter (view)
import Control.Monad.Composable.Kafka
import qualified Network.Kafka.Protocol as KP

stateDiffTopicName :: KP.TopicName
stateDiffTopicName = lookupTopic "statediff"

assertStateDiffTopicCreation :: HasKafka k => k ()
assertStateDiffTopicCreation = createTopic stateDiffTopicName

{-
mkTopicAndMessage :: (ToJSON a) => a -> K.TopicAndMessage
mkTopicAndMessage = K.TopicAndMessage stateDiffTopicName . KW.makeMessage . L.toStrict . encode

writeActionJSONToKafka :: (K.Kafka k) => [Action] -> k [KP.ProduceResponse]
writeActionJSONToKafka = KW.produceMessages . map mkTopicAndMessage
-}
filterResponse :: [KP.ProduceResponse] -> [(KP.Partition, KP.KafkaError, KP.Offset)]
filterResponse = concatMap onlyErrors
  where
    onlyErrors :: KP.ProduceResponse -> [(KP.Partition, KP.KafkaError, KP.Offset)]
    onlyErrors resp =
      let errs = concatMap snd . view KP.produceResponseFields $ resp
          isError (_, e, _) = e /= KP.NoError
       in filter isError errs
