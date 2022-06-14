{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE GADTs                 #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TypeFamilies          #-}
{-# OPTIONS_GHC -fno-warn-orphans       #-}


module Blockchain.Stream.VMEvent (
  VMEvent(..),
  produceVMEvents,
  produceVMEventsM,
  fetchVMEvents,
  fetchVMEvents',
  fetchVMEventsIO,
  fetchVMEventsOneIO,
  fetchLastVMEvents,
  fetchVMEventsFromTopic,
  defaultVMEventsTopicName,
  HasVMEventsSink(..)
) where

import           Conduit
import           Control.Monad.Change.Modify (Modifiable)
import           Control.Monad.State
import           Control.Exception
import qualified Data.Aeson                  as JSON
import qualified Data.ByteString             as B
import qualified Data.ByteString.Lazy        as BL
import           Data.Text                   (Text)
import qualified Data.Text                   as T
import           Data.Maybe
import           GHC.Generics

import           Network.Kafka
import           Network.Kafka.Producer
import           Network.Kafka.Protocol      hiding (Key)

import           BlockApps.Logging
import           Blockchain.Data.TransactionResult
import           Blockchain.EthConf
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Event
import           Blockchain.Stream.Action (Action)
import           Blockchain.KafkaTopics
import           Blockchain.MilenaTools
import           Blockchain.Stream.Raw
import           Text.Format
import           Text.Tools


data VMEvent =
  NewAction Action |
  EventEmitted Event |
  CodeCollectionAdded {
    ccString :: Text,
    codePtr :: CodePtr,
    organization :: Text,
    application :: Text,
    historyList :: [Text]
    } |
  NewTransactionResult TransactionResult deriving (Show, Generic)

instance JSON.ToJSON VMEvent where

instance JSON.FromJSON VMEvent where

vmType :: CodePtr -> String
vmType (SolidVMCode _ _) = "SolidVM"
vmType (EVMCode _) = "EVM"
vmType (CodeAtAccount _ _) = "CodeAtAccount"


instance Format VMEvent where
  format (NewAction a) = "NewAction:\n" ++ tab (format a)
  format (EventEmitted e) = "EventEmitted:\n" ++ tab (format e)
  format (CodeCollectionAdded c cp o a hl) =
    "CodeCollectionAdded: (" ++ show o ++ "/" ++ show a ++ ") " ++ vmType cp
    ++ (if (not $ null hl) then " " ++ show hl else "") ++ "\n    "
    ++ show (shorten 120 (T.unpack c))
  format (NewTransactionResult tr) = "NewTransactionResult:\n" ++ tab (format tr)

class HasVMEventsSink k where
  getVMEventsSink :: k ([VMEvent] -> k ())

produceVMEventsM :: (Modifiable KafkaState m, MonadLogger m, MonadIO m) => [VMEvent] -> m Offset
produceVMEventsM vmEvents = do
    x <- withKafkaRetry1s . produceMessagesAsSingletonSets $
        map (TopicAndMessage (lookupTopic "vmevents") . makeMessage . BL.toStrict . JSON.encode) vmEvents

    let [offset] = concatMap (map (\(_, _, x') ->x') . concatMap snd . _produceResponseFields) x
    return offset

-- todo: refactor this to consume produceVMEventsM
produceVMEvents:: (MonadIO m) => [VMEvent] -> m Offset
produceVMEvents vmEvents = do
  result <- -- type Either KafkaClientError [ProduceResponse]
    liftIO $ runKafkaConfigured "blockapps-data" $ fmap concat $
      forM vmEvents $ \e -> produceMessagesAsSingletonSets [TopicAndMessage (lookupTopic "vmevents") . makeMessage . BL.toStrict . JSON.encode $ e]
  case result of 
    Left kce -> liftIO $ throwIO kce
    Right res -> do -- [ProduceResponse]
      liftIO $ mapM_ parseKafkaResponse res
      return offset
      where [offset] = concatMap (map (\(_, _, x') -> x') . concatMap snd . _produceResponseFields) res
            -- parsedResults = map parseKafkaResponse res


-- | Reads VMEvents from `defaultVMEventsTopicName`
fetchVMEvents :: Kafka k => Offset -> k [VMEvent]
fetchVMEvents = fetchVMEventsFromTopic defaultVMEventsTopicName

-- | Same as `fetchVMEvents`, except sets our commonly-used Milena state configurations
fetchVMEvents' :: Kafka k => Offset -> k [VMEvent]
fetchVMEvents' ofs = fetchVMEventsFromTopic defaultVMEventsTopicName ofs

fetchVMEventsFromTopic :: Kafka k => TopicName -> Offset -> k [VMEvent]
fetchVMEventsFromTopic topic offset = map bytestringToVMEvent <$> fetchBytes topic offset

defaultVMEventsTopicName :: TopicName
defaultVMEventsTopicName = lookupTopic "vmevents"

bytestringToVMEvent :: B.ByteString -> VMEvent
bytestringToVMEvent x =
  fromMaybe (error $ "bytestringToVMEvent called on invalid data: " ++ show x) . JSON.decode . BL.fromStrict $ x


fetchVMEventsIO::Offset->IO (Maybe [VMEvent])
fetchVMEventsIO offset =
  fmap (map bytestringToVMEvent) <$> fetchBytesIO (lookupTopic "vmevents") offset

fetchVMEventsOneIO::Offset->IO (Maybe VMEvent)
fetchVMEventsOneIO offset =
  fmap bytestringToVMEvent <$> fetchBytesOneIO (lookupTopic "vmevents") offset

fetchLastVMEvents::Offset->IO [VMEvent]
fetchLastVMEvents n = do
  ret <-
    runKafkaConfigured "strato-p2p-client" $ do
      lastOffset <- getLastOffset LatestTime 0 (lookupTopic "vmevents")
      when (lastOffset == 0) $ error "Block stream is empty, you need to run strato-setup to insert the genesis block."
      let offset = max (lastOffset - n) 0
      fetchVMEvents offset

  case ret of
    Left e  -> error $ show e
    Right v -> return v
