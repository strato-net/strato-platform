{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Stream.VMEvent
  ( VMEvent(..),
    produceVMEvents,
  )
where

import Blockchain.Data.TransactionResult
import Blockchain.EthConf (ethConf, publishVmEvents, vmConfig)
import Blockchain.Strato.Model.Keccak256
import Blockchain.Stream.Action (Action)
import Control.Monad.Composable.Streaming
import qualified Data.Aeson as JSON
import Data.Binary
import Data.Text (Text)
import GHC.Generics
import SolidVM.Model.CodeCollection
import Text.Format
import Text.Tools

data VMEvent
  = NewAction Action
  | CodeCollectionAdded
      { codeCollection :: CodeCollectionF (),
        creator :: Text,
        codeHash :: Keccak256
      }
  | NewTransactionResult TransactionResult
  deriving (Show, Generic)

instance Format VMEvent where
  format (NewAction a) = "NewAction:\n" ++ tab (format a)
  format (CodeCollectionAdded _ cr ch) =
    "CodeCollectionAdded: (" ++ show cr ++ ", " ++ keccak256ToHex ch ++ ") "
  format (NewTransactionResult tr) = "NewTransactionResult:\n" ++ tab (format tr)

instance Binary VMEvent

instance JSON.ToJSON VMEvent

instance JSON.FromJSON VMEvent

-- | Nothing is written on a node that runs no slipstream (publishVmEvents
-- off): the stream would have no reader, and JLog only trims what a reader
-- has passed.
produceVMEvents :: HasStreaming k => [VMEvent] -> k [ProduceResponse]
produceVMEvents vmes
  | publishVmEvents (vmConfig ethConf) = produceItems "vmevents" vmes
  | otherwise = return []
