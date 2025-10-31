{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

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
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.Keccak256
import Blockchain.Stream.Action (Delegatecall, DataDiff)
import Conduit
import Control.Monad.Composable.Kafka
import qualified Data.Aeson as JSON
import Data.Binary
import Data.Foldable
import qualified Data.Map.Ordered as OMap
import Data.Sequence (Seq)
import Data.Text (Text)
import Data.Time
import GHC.Generics
import SolidVM.Model.CodeCollection hiding (Event, events)
import Text.Format
import Text.Tools

data VMEvent
  = NewBlockData
    { blockHash :: Keccak256,
      blockTimestamp :: UTCTime,
      blockNumber :: Integer,
      transactionSender :: Address,
      actionData :: OMap.OMap Address DataDiff,
      newCodeCollections :: [(Text, CodeCollection)],
      events :: Seq Event,
      delegatecalls :: Seq Delegatecall
    }
  | CodeCollectionAdded
      { codeCollection :: CodeCollectionF (),
        creator :: Text
      }
  | NewTransactionResult TransactionResult
  deriving (Show, Generic)

instance Format VMEvent where
  format NewBlockData{..} = "NewBlockData:\n" ++ tab (
    "blockHash: " ++ format blockHash ++ "\n"
      ++ "actionBlockTimestamp: " ++ show blockTimestamp ++ "\n"
      ++ "actionBlockNumber: " ++ show blockNumber ++ "\n"
      ++ "actionTransactionSender: " ++ format transactionSender ++ "\n"
      ++ "actionData:\n" ++ unlines (map (\(k, v) -> tab $ format k ++ ":\n" ++ (tab $ format v)) $ OMap.assocs actionData) ++ "\n"
      ++ "actionEvents: " ++ unlines (map show $ toList events) ++ "\n"
      ++ "actionDelegatecalls: " ++ unlines (map show $ toList delegatecalls) ++ "\n"
    )
  format (CodeCollectionAdded _ cr) =
    "CodeCollectionAdded: (" ++ show cr ++ ") "
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
