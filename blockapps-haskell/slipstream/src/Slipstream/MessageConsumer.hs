{-# LANGUAGE
      OverloadedStrings
    , DeriveGeneric
    , FlexibleContexts
    , LambdaCase
    , TemplateHaskell
#-}

module Slipstream.MessageConsumer where

import Control.Concurrent     (threadDelay)
import Control.Exception.Lifted
import Control.Lens
import Control.Monad.Reader
import Control.Retry
import Data.Aeson hiding (Error)
import qualified Data.ByteString as B
import Data.IORef
import Data.List
import qualified Data.List.NonEmpty as NE
import qualified Data.Map as M
import Data.String
import Database.PostgreSQL.Typed
import GHC.Generics
import Network.Kafka
import Network.Kafka.Consumer
import qualified Network.Kafka.Protocol as K hiding (Message)
import System.Log.Logger

import BlockApps.Bloc22.Monad (BlocEnv)
import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.Options
import Slipstream.Processor

exceptionMaxCount :: Int
exceptionMaxCount = 20

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

makeKafkaState :: KafkaClientId -> KafkaAddress -> K.MaxBytes -> KafkaState
makeKafkaState cid addy maxBytes =
    KafkaState cid
               defaultRequiredAcks
               defaultRequestTimeout
               defaultMinBytes
               maxBytes
               defaultMaxWaitTime
               defaultCorrelationId
               M.empty
               M.empty
               M.empty
               (addy NE.:| [])

mkConfiguredKafkaState :: KafkaClientId -> K.MaxBytes -> KafkaState
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

getAndProcessMessages :: Kafka a => BlocEnv -> PGConnection -> IORef Globals -> K.Offset -> Int -> a ()
getAndProcessMessages env conn cache offset errorCounter = do
  eMessages <- try $ getTheMessages offset
  case eMessages of
    Left e -> do
      liftIO $ threadDelay 1000000
      liftIO . errorM "getTheMessages: " . show $ (e :: KafkaClientError)
      if (errorCounter > exceptionMaxCount )
           then error $ "Slipstream reached exceptionMaxCount."
           else getAndProcessMessages env conn cache offset (errorCounter + 1)
    Right messages -> do
      recordKafkaMessages messages
      forceGlobalEval cache
      liftIO $ processTheMessages env conn cache messages
      when (null messages) $
        liftIO $ threadDelay 1000000
      getAndProcessMessages env conn cache (offset + fromIntegral (length messages)) errorCounter
