{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Stream.VMEvent
  ( VMEvent(..),
    produceVMEvents,
    fetchVMEvents
  )
where

import Blockchain.Data.TransactionResult
import Blockchain.EthConf
import Blockchain.KafkaTopics
import Blockchain.MilenaTools
import Blockchain.Strato.Model.CodePtr
import Blockchain.Stream.Action (Action, Delegatecall)
import Blockchain.Stream.Raw
import Conduit
import Control.Exception
import Control.Monad.State
import qualified Data.Aeson as JSON
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Maybe
import Data.Text (Text)
import qualified Data.Text as T
import GHC.Generics
import Network.Kafka
import Network.Kafka.Producer
import Network.Kafka.Protocol hiding (Key)
import Text.Format
import Text.Tools

data VMEvent
  = NewAction Action
  | CodeCollectionAdded
      { ccString :: Text,
        codePtr :: CodePtr,
        organization :: Text,
        application :: Text,
        historyList :: [Text],
        recordMappings :: [Text]
      }
  | DelegatecallMade Delegatecall
  | NewTransactionResult TransactionResult
  deriving (Show, Generic)

vmType :: CodePtr -> String
vmType (SolidVMCode _ _) = "SolidVM"
vmType (EVMCode _) = "EVM"
vmType (CodeAtAccount _ _) = "CodeAtAccount"

instance Format VMEvent where
  format (NewAction a) = "NewAction:\n" ++ tab (format a)
  format (CodeCollectionAdded c cp o a hl rm) =
    "CodeCollectionAdded: (" ++ show o ++ "/" ++ show a ++ ") " ++ vmType cp
      ++ (if (not $ null hl) then " " ++ show hl else "")
      ++ (if (not $ null rm) then " " ++ show rm else "")
      ++ "\n    "
      ++ show (shorten 120 (T.unpack c))
  format (DelegatecallMade d) =
    "DelegatecallMade: " ++ format d
  format (NewTransactionResult tr) = "NewTransactionResult:\n" ++ tab (format tr)

instance Binary VMEvent

instance JSON.ToJSON VMEvent

instance JSON.FromJSON VMEvent

-- todo: refactor this to consume produceVMEventsM
produceVMEvents :: (MonadIO m) => [VMEvent] -> m Offset
produceVMEvents vmEvents = do
  result <- -- type Either KafkaClientError [ProduceResponse]
    liftIO $
      runKafkaConfigured "blockapps-data" $
        fmap concat $
          forM vmEvents $ \e -> produceMessagesAsSingletonSets [TopicAndMessage (lookupTopic "vmevents") . makeMessage . BL.toStrict . JSON.encode $ e]
  case result of
    Left kce -> liftIO $ throwIO kce
    Right res -> do
      -- [ProduceResponse]
      liftIO $ mapM_ parseKafkaResponse res
      return offset
      where
        -- where [offset] = concatMap (map (\(_, _, x') -> x') . concatMap snd . _produceResponseFields) res
        offset = case concatMap (map (\(_, _, x') -> x') . concatMap snd . _produceResponseFields) res of
          [theOffset] -> theOffset
          _ -> error "produceVMEvents: unexpected response from Kafka"

-- parsedResults = map parseKafkaResponse res

-- | Reads VMEvents from `defaultVMEventsTopicName`
fetchVMEvents :: Kafka k => Offset -> k [VMEvent]
fetchVMEvents = fetchVMEventsFromTopic defaultVMEventsTopicName

fetchVMEventsFromTopic :: Kafka k => TopicName -> Offset -> k [VMEvent]
fetchVMEventsFromTopic topic offset = map bytestringToVMEvent <$> fetchBytes topic offset

defaultVMEventsTopicName :: TopicName
defaultVMEventsTopicName = lookupTopic "vmevents"

bytestringToVMEvent :: B.ByteString -> VMEvent
bytestringToVMEvent x =
  fromMaybe (error $ "bytestringToVMEvent called on invalid data: " ++ show x) . JSON.decode . BL.fromStrict $ x
