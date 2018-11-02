{-# LANGUAGE
      OverloadedStrings
    , DeriveGeneric
    , FlexibleContexts
    , LambdaCase
#-}

module Slipstream.MessageConsumer where

import Control.Exception.Lifted
import Control.Monad.Reader
import Control.Retry
import Data.Aeson hiding (Error)
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

getTheMessages :: Kafka k => K.Offset -> k [B.ByteString]
getTheMessages offset = do
  let extract :: K.FetchResponse -> Either String [B.ByteString]
      extract fr =
        let errorStatuses = concatMap (^.. _2 . folded . _2) (fr ^. K.fetchResponseFields)
        in case find (/= K.NoError) errorStatuses of
          Just e -> Left . show $ e
          Nothing -> Right . map tamPayload . fetchMessages $ fr
      shouldRetry :: (MonadIO m) => RetryStatus -> Either String [B.ByteString] -> m Bool
      shouldRetry _ = \case
                         Left e -> do
                           liftIO . criticalM "getTheMessages/kafka_response" . show $ e
                           return True
                         Right _ -> return False
      policy :: RetryPolicy
      policy = limitRetriesByCumulativeDelay 20000000 . exponentialBackoff $ 40000
  fetched <- retrying policy shouldRetry . const $ extract <$> fetch offset 0 lookupTopic
  return $ case fetched of
              Left e -> error $ "getTheMessages: " ++ e
              Right bs -> bs


getAndProcessMessages :: Kafka a => PGConnection -> IORef Globals -> K.Offset -> a ()
getAndProcessMessages conn cache offset = do
  eMessages <- try $ getTheMessages offset
  case eMessages of
    Left e -> error $ show (e :: SomeException)
    Right messages -> do
      liftIO $ processTheMessages messages conn cache
      when (null messages) $
        liftIO $ threadDelay 1000000
      getAndProcessMessages conn cache $ offset + fromIntegral (length messages)
