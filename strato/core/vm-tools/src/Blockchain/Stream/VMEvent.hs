{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Stream.VMEvent
  ( VMEvent(..),
    produceVMEvents,
    produceVMEvents',
    runKafkaVMEvents,
    fetchVMEvents
  )
where

import Blockchain.Data.TransactionResult
import Blockchain.EthConf
import Blockchain.KafkaTopics
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import Blockchain.Stream.Action (Action)
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
        abstracts :: Map (Address, Text) (Text, Text, [Text])
      }
  | NewTransactionResult TransactionResult
  deriving (Show, Generic)

vmType :: CodePtr -> String
vmType (SolidVMCode _ _) = "SolidVM"
vmType (ExternallyOwned _) = "EVM"

instance Format VMEvent where
  format (NewAction a) = "NewAction:\n" ++ tab (format a)
  format (CodeCollectionAdded _ cp cr ap _) =
    "CodeCollectionAdded: (" ++ show cr ++ "/" ++ show ap ++ ") " ++ vmType cp
  format (NewTransactionResult tr) = "NewTransactionResult:\n" ++ tab (format tr)

instance Binary VMEvent

instance JSON.ToJSON VMEvent

instance JSON.FromJSON VMEvent

produceVMEvents :: MonadIO m => [VMEvent] -> m [ProduceResponse]
produceVMEvents = runKafkaVMEvents . produceVMEvents'

produceVMEvents' :: HasKafka k => [VMEvent] -> k [ProduceResponse]
produceVMEvents' = produceItems (lookupTopic "vmevents")

runKafkaVMEvents :: MonadIO m => KafkaM m a -> m a
runKafkaVMEvents = runKafkaMConfigured "blockapps-data"

fetchVMEvents :: HasKafka k => Offset -> k [VMEvent]
fetchVMEvents = fetchItems $ lookupTopic "vmevents"
