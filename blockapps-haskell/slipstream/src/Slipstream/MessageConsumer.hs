{-# LANGUAGE
      DeriveGeneric
    , LambdaCase
    , OverloadedStrings
    , FlexibleContexts
    , TemplateHaskell
#-}

module Slipstream.MessageConsumer (
  getAndProcessMessages
  ) where

import Control.Monad.IO.Unlift
import Data.IORef
import Data.String
import Database.PostgreSQL.Typed
import qualified Network.Kafka.Protocol as K hiding (Message)

import BlockApps.Bloc22.Monad (BlocEnv)
import BlockApps.Logging
import Blockchain.MilenaTools
import Blockchain.Stream.VMEvent

import Control.Monad.Composable.BlocSQL
import Control.Monad.Composable.Kafka

import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.Processor

lookupTopic :: K.TopicName
lookupTopic = fromString "statediff"

lookupPartition :: K.Partition
lookupPartition = K.Partition 0

lookupGroup :: K.ConsumerGroup
lookupGroup = "slipstream"

getStatediffOffset :: (MonadIO m, MonadLogger m, HasKafka m) =>
                      m K.Offset
getStatediffOffset = do
  resp <- execKafka $ fetchSingleOffset lookupGroup lookupTopic lookupPartition
  $logDebugLS "getStateDiffOffset/resp" resp
  case resp of
    Left K.UnknownTopicOrPartition -> do
      $logInfoS "getStatediffOffset" "No offset found, creating one from 0"
      putStatediffOffset 0 >> getStatediffOffset
    Left err -> do
      $logErrorLS "getStatediffOffset" err
      error $ show err
    Right (off, _) -> return off

putStatediffOffset :: (MonadIO m, MonadLogger m, HasKafka m) =>
                      K.Offset -> m ()
putStatediffOffset off = do
    $logInfoLS "putStateDiffOffset/req" off
    resp <- execKafka $ commitSingleOffset lookupGroup lookupTopic lookupPartition off ""
    $logDebugLS "putStateDiffOffset/resp" resp
    case resp of
      Left err -> do
        $logErrorLS "putStatediffOffset" err
        error $ show err
      Right () -> return ()

getAndProcessMessages :: (MonadIO m, MonadLogger m, MonadUnliftIO m, HasKafka m) =>
                         BlocEnv -> BlocSQLEnv -> PGConnection -> IORef Globals -> m ()
getAndProcessMessages env sqlEnv conn cache = do
  let errorCount = 0
  offset <- getStatediffOffset
  getAndProcessMessages' env sqlEnv conn cache offset errorCount

getAndProcessMessages' :: (MonadIO m, MonadLogger m, MonadUnliftIO m, HasKafka m) =>
                          BlocEnv -> BlocSQLEnv -> PGConnection -> IORef Globals -> K.Offset -> Int -> m ()
getAndProcessMessages' env sqlEnv conn cache offset errorCounter = do
  recordOffset offset
  messages <- execKafka $ fetchVMEvents offset
  $logDebugLS "getAndProcessMessages'" messages
  recordKafkaMessages messages
  forceGlobalEval cache
  processTheMessages env sqlEnv conn cache messages
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
