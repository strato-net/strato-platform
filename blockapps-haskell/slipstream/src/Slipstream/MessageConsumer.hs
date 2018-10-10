{-# LANGUAGE
      OverloadedStrings
    , DeriveGeneric
    , FlexibleContexts
#-}

module Slipstream.MessageConsumer where

import Control.Monad.Reader
import Data.Aeson hiding (Error)
import qualified Data.ByteString.Char8 as BC
import GHC.Generics
import qualified Data.Map as M
import qualified Data.ByteString as B
import Network.Kafka
import Network.Kafka.Consumer
import qualified Network.Kafka.Protocol as K hiding (Message)
import qualified Data.List.NonEmpty as NE
import Data.String
import Control.Lens
import Data.List
import Control.Concurrent
import Database.PostgreSQL.Typed
import Data.IORef
import System.Log.Logger
import Text.Printf

import Slipstream.Globals
import Slipstream.Options
import Slipstream.Processor

defaultMaxB :: K.MaxBytes
defaultMaxB = 32 * 1024 * 1024

data KafkaConf =
  KafkaConf {
      kafkaHost :: String,
      kafkaPort :: Int
  } deriving (Generic)

defaultKafkaConfig  ::  KafkaConf
defaultKafkaConfig = KafkaConf {
  kafkaHost = flags_kafkahost
  , kafkaPort = flags_kafkaport
  }

instance FromJSON KafkaConf
instance ToJSON KafkaConf

makeKafkaState :: KafkaClientId -> KafkaAddress -> KafkaState
makeKafkaState cid addy =
    KafkaState cid
               defaultRequiredAcks
               defaultRequestTimeout
               defaultMinBytes
               defaultMaxB
               defaultMaxWaitTime
               defaultCorrelationId
               M.empty
               M.empty
               M.empty
               (addy NE.:| [])

mkConfiguredKafkaState :: KafkaClientId -> KafkaState
mkConfiguredKafkaState cid = makeKafkaState cid (kh, kp)
  where k = defaultKafkaConfig
        kh = fromString $ kafkaHost k
        kp = fromIntegral $ kafkaPort k

lookupTopic :: K.TopicName
lookupTopic = fromString "statediff"

getTheMessages :: Kafka a => K.Offset -> a [B.ByteString]
getTheMessages offset@(K.Offset o) = do
  fetched <- fetch offset 0 lookupTopic
  let errorStatuses = concatMap (^.. _2 . folded . _2) (fetched ^. K.fetchResponseFields)
  case find (/= K.NoError) errorStatuses of
   Just e -> do
    liftIO . debugM "getTheMessages/kafka_response" . show $ fetched
    let topic = BC.unpack (lookupTopic ^. K.tName ^. K.kString)
    error $ printf "There was a critical Kafka error while fetching messages: %s\ntopic = %s, offset = %d" (show e) topic o
   Nothing -> return ()
  let ret = (map tamPayload . fetchMessages) fetched
  return ret

getAndProcessMessages :: Kafka a => PGConnection -> IORef Globals ->  K.Offset -> a ()
getAndProcessMessages conn cache offset = do
  messages <- getTheMessages offset
  liftIO $ processTheMessages messages conn cache
  when (null messages) $
    liftIO $ threadDelay 1000000
  getAndProcessMessages conn cache $ offset + fromIntegral (length messages)
