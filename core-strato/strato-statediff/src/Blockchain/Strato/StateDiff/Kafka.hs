module Blockchain.Strato.StateDiff.Kafka
    ( stateDiffTopicName
    , assertTopicCreation
    , writeActionJSONToKafka
    , filterResponse
    , mkMessages -- For testing
    ) where

import           Control.Lens.Getter               (view)
import           Control.Monad.Extra
import           Data.Aeson
import qualified Data.ByteString                   as B
import qualified Data.ByteString.Lazy              as L
import qualified Network.Kafka                     as K
import qualified Network.Kafka.Producer            as KW
import qualified Network.Kafka.Protocol            as KP

import           Blockchain.Strato.Model.Action

stateDiffTopicName :: KP.TopicName
stateDiffTopicName = KP.TName  . KP.KString $ "statediff"

assertTopicCreation :: K.Kafka k => k ()
assertTopicCreation = K.updateMetadata stateDiffTopicName

-- Provide an approximate message size
mkTopicAndMessage :: (ToJSON a) => a -> (Int, K.TopicAndMessage)
mkTopicAndMessage item =
  let bs = L.toStrict $! encode item
  in (B.length bs, K.TopicAndMessage stateDiffTopicName $! KW.makeMessage bs)

mkMessages :: (ToJSON a) => Int -> [a] -> [[K.TopicAndMessage]]
mkMessages batchLimit = go 0 [] . map mkTopicAndMessage
  where go :: Int -> [K.TopicAndMessage] -> [(Int, K.TopicAndMessage)] -> [[K.TopicAndMessage]]
        go _ pendingMsgs [] = [pendingMsgs]
        go pendingSize pendingMsgs ((thisSize, msg):rest) =
            if pendingSize + thisSize > batchLimit
              then pendingMsgs:go thisSize [msg] rest
              else go (pendingSize + thisSize) (msg:pendingMsgs) rest

defaultSocketRequestMaxBytes :: Int
defaultSocketRequestMaxBytes = 104857600

writeActionJSONToKafka :: (K.Kafka k) => [Action] -> k [KP.ProduceResponse]
writeActionJSONToKafka = concatMapM KW.produceMessages . mkMessages defaultSocketRequestMaxBytes

filterResponse :: [KP.ProduceResponse] -> [(KP.Partition, KP.KafkaError, KP.Offset)]
filterResponse = concatMap onlyErrors
  where onlyErrors :: KP.ProduceResponse -> [(KP.Partition, KP.KafkaError, KP.Offset)]
        onlyErrors resp = let errs = concatMap snd . view KP.produceResponseFields $ resp
                              isError (_, e, _) = e /= KP.NoError
                          in filter isError errs
