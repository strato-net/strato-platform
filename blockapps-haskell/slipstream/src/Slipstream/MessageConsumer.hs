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
import Control.Monad.Trans.State
import Control.Monad.Trans.Except
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

import BlockApps.Bloc22.Monad (BlocEnv)
import BlockApps.Logging
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

type SlipKafka = StateT KafkaState (ExceptT KafkaClientError (LoggingT IO))

runKafka :: KafkaState -> SlipKafka a -> LoggingT IO (Either KafkaClientError a)
runKafka s k = runExceptT $ evalStateT k s

makeKafkaState :: KafkaClientId -> KafkaAddress -> K.MaxBytes -> KafkaState
makeKafkaState cid addy maxBytes =
  let waitTime = 100000 -- 100s
      minBytes = 1      -- Awaken from sleep only if there is at least one message
  in KafkaState cid
                defaultRequiredAcks
                defaultRequestTimeout
                minBytes
                maxBytes
                waitTime
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

lookupPartition :: K.Partition
lookupPartition = K.Partition 0

lookupGroup :: K.ConsumerGroup
lookupGroup = "slipstream"

generateRequestId :: SlipKafka (K.CorrelationId, K.ClientId)
generateRequestId = liftM2 (,) (stateCorrelationId <<+= 1) (uses stateName K.ClientId)

-- TODO: Use blockapps-milena to get topic stored offsets instead of zookeeper ones.
getStatediffOffset :: SlipKafka K.Offset
getStatediffOffset = getLastOffset LatestTime lookupPartition lookupTopic

putStatediffOffset :: K.Offset -> SlipKafka ()
putStatediffOffset off = do
    (corrId, clientId) <- generateRequestId
    let commitRequest = K.OffsetCommitRequest
               $ K.OffsetCommitReq (lookupGroup, [(lookupTopic, [(lookupPartition, off, protocolTime LatestTime, K.Metadata "")])])
        req = K.Request (corrId, clientId, commitRequest)
    resp <- withAnyHandle $ \h -> K.doRequest' corrId h req :: SlipKafka (Either String K.OffsetCommitResponse)
    $logInfoLS "putStatediffOffset/req" req
    $logInfoLS "putStatediffOffset/resp" resp


getTheMessages :: K.Offset -> SlipKafka [B.ByteString]
getTheMessages offset = do
  let extract :: K.FetchResponse -> Either String [B.ByteString]
      extract fr =
        let errorStatuses = concatMap (^.. _2 . folded . _2) (fr ^. K.fetchResponseFields)
        in case find (/= K.NoError) errorStatuses of
          Just e -> Left . show $ e
          Nothing -> Right . map tamPayload . fetchMessages $ fr
      shouldRetry :: (MonadLogger m) => RetryStatus -> Either String [B.ByteString] -> m Bool
      shouldRetry _ = \case
                         Left e -> do
                           $logErrorLS "getTheMessages/kafka_response" e
                           return True
                         Right _ -> return False
      policy :: RetryPolicy
      policy = limitRetriesByCumulativeDelay 20000000 . exponentialBackoff $ 40000
  fetched <- retrying policy shouldRetry . const $ extract <$> fetch offset 0 lookupTopic
  return $ case fetched of
              Left e -> error $ "getTheMessages: " ++ e
              Right bs -> bs

getAndProcessMessages :: BlocEnv -> PGConnection -> IORef Globals -> SlipKafka ()
getAndProcessMessages env conn cache = do
  let errorCount = 0
  offset <- getStatediffOffset
  getAndProcessMessages' env conn cache offset errorCount

getAndProcessMessages' :: BlocEnv -> PGConnection -> IORef Globals -> K.Offset -> Int -> SlipKafka ()
getAndProcessMessages' env conn cache offset errorCounter = do
  recordOffset offset
  eMessages <- try $ getTheMessages offset
  case eMessages of
    Left e -> do
      $logErrorLS "getTheMessages" (e :: KafkaClientError)
      liftIO $ threadDelay 1000000
      if (errorCounter > exceptionMaxCount )
           then error $ "Slipstream reached exceptionMaxCount."
           else getAndProcessMessages' env conn cache offset (errorCounter + 1)
    Right messages -> do
      $logDebugLS "getAndProcessMessages'" messages
      recordKafkaMessages messages
      forceGlobalEval cache
      lift . lift $ processTheMessages env conn cache messages
      let newOffset = offset + fromIntegral (length messages)
      currentOffset <- getStatediffOffset
      offset' <- if currentOffset /= offset
                    then do
                      $logInfoLS "getAndProcessMessages'/manual_offset" currentOffset
                      recordOffsetOverride
                      return currentOffset
                    else do
                      putStatediffOffset newOffset
                      return newOffset

      getAndProcessMessages' env conn cache offset' errorCounter
