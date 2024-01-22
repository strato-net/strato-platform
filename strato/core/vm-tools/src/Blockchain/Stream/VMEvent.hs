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
import Blockchain.Strato.Model.CodePtr
import Blockchain.Stream.Action (Action, Delegatecall)
import Conduit
import Control.Monad.Composable.Kafka
import qualified Data.Aeson as JSON
import Data.Binary
import Data.Text (Text)
import qualified Data.Text as T
import GHC.Generics
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

produceVMEvents :: MonadIO m => [VMEvent] -> m [ProduceResponse]
produceVMEvents = runKafkaMConfigured "blockapps-data" . produceItems (lookupTopic "vmevents")

fetchVMEvents :: HasKafka k => Offset -> k [VMEvent]
fetchVMEvents = fetchItems $ lookupTopic "vmevents"
