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
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.CodePtr
import Blockchain.Stream.Action (Action, Delegatecall)
import Conduit
import Control.Monad.Composable.Kafka
import qualified Data.Aeson as JSON
import Data.Binary
import Data.Map.Strict (Map)
import Data.Text (Text)
import GHC.Generics
import SolidVM.Model.CodeCollection
import Text.Format
import Text.Tools

data VMEvent
  = NewAction Action
  | CodeCollectionAdded
      { codeCollection :: CodeCollectionF (),
        codePtr :: CodePtr,
        creator :: Text,
        application :: Text,
        historyList :: [Text],
        abstracts :: Map (Account, Text) (Text, Text, [Text]),
        recordMappings :: [Text]
      }
  | DelegatecallMade Delegatecall
  | NewTransactionResult TransactionResult
  deriving (Show, Generic)

vmType :: CodePtr -> String
vmType (SolidVMCode _ _) = "SolidVM"
vmType (ExternallyOwned _) = "EVM"
vmType (CodeAtAccount _ _) = "CodeAtAccount"

instance Format VMEvent where
  format (NewAction a) = "NewAction:\n" ++ tab (format a)
  format (CodeCollectionAdded _ cp cr ap hl _ rm) =
    "CodeCollectionAdded: (" ++ show cr ++ "/" ++ show ap ++ ") " ++ vmType cp
      ++ (if (not $ null hl) then " " ++ show hl else "")
      ++ (if (not $ null rm) then " " ++ show rm else "")
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
