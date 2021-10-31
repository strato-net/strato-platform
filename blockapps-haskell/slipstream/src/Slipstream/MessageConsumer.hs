{-# LANGUAGE
      DeriveGeneric
    , LambdaCase
    , OverloadedStrings
    , FlexibleContexts
    , TemplateHaskell
#-}

module Slipstream.MessageConsumer (
  mkConfiguredKafkaState,
  runKafka,
  getAndProcessMessages
  ) where

import Control.Monad.Reader
import Control.Monad.Trans.State
import Control.Monad.Trans.Except
import Data.Aeson hiding (Error)
import Data.IORef
import qualified Data.List.NonEmpty as NE
import qualified Data.Map as M
import Data.String
import Database.PostgreSQL.Typed
import GHC.Generics
import Network.Kafka                    hiding (runKafka)
import qualified Network.Kafka.Protocol as K hiding (Message)

import BlockApps.Bloc22.Monad (BlocEnv)
import BlockApps.Logging
import Blockchain.MilenaTools
import Blockchain.Stream.VMEvent

import Control.Monad.Composable.BlocSQL

import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.Options
import Slipstream.Processor

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

getStatediffOffset :: (MonadLogger m, Kafka m) =>
                      m K.Offset
getStatediffOffset = do
  resp <- fetchSingleOffset lookupGroup lookupTopic lookupPartition
  $logDebugLS "getStateDiffOffset/resp" resp
  case resp of
    Left K.UnknownTopicOrPartition -> do
      $logInfoS "getStatediffOffset" "No offset found, creating one from 0"
      putStatediffOffset 0 >> getStatediffOffset
    Left err -> do
      $logErrorLS "getStatediffOffset" err
      error $ show err
    Right (off, _) -> return off

putStatediffOffset :: (MonadLogger m, Kafka m) =>
                      K.Offset -> m ()
putStatediffOffset off = do
    $logInfoLS "putStateDiffOffset/req" off
    resp <- commitSingleOffset lookupGroup lookupTopic lookupPartition off ""
    $logDebugLS "putStateDiffOffset/resp" resp
    case resp of
      Left err -> do
        $logErrorLS "putStatediffOffset" err
        error $ show err
      Right () -> return ()

getAndProcessMessages :: BlocEnv -> BlocSQLEnv -> PGConnection -> IORef Globals -> SlipKafka ()
getAndProcessMessages env sqlEnv conn cache = do
  let errorCount = 0
  offset <- getStatediffOffset
  getAndProcessMessages' env sqlEnv conn cache offset errorCount

getAndProcessMessages' :: BlocEnv -> BlocSQLEnv -> PGConnection -> IORef Globals -> K.Offset -> Int -> SlipKafka ()
--getAndProcessMessages' :: (MonadIO m, MonadLogger m, Kafka m) =>
--                          BlocEnv -> BlocSQLEnv -> PGConnection -> IORef Globals -> K.Offset -> Int -> m ()
getAndProcessMessages' env sqlEnv conn cache offset errorCounter = do
  recordOffset offset
  messages <- fetchVMEvents offset
  $logDebugLS "getAndProcessMessages'" messages
  recordKafkaMessages messages
  forceGlobalEval cache
  lift . lift $ processTheMessages env sqlEnv conn cache messages
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

  getAndProcessMessages' env sqlEnv conn cache offset' errorCounter
