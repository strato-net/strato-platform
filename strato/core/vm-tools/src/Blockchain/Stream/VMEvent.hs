{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Stream.VMEvent
  ( VMEvent(..),
    produceVMEvents,
    produceEncodedVMEvents,
  )
where

import Blockchain.Data.TransactionResult
import Blockchain.Strato.Model.Keccak256
import Blockchain.Stream.Action (Action)
import Control.Monad.Composable.Streaming
import qualified Data.Aeson as JSON
import Data.Binary
import qualified Data.ByteString as B
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

produceVMEvents :: HasStreaming k => [VMEvent] -> k [ProduceResponse]
produceVMEvents = produceItemsBatched "vmevents"

produceEncodedVMEvents :: HasStreaming k => [B.ByteString] -> k [ProduceResponse]
produceEncodedVMEvents = produceEncodedItemsBatched "vmevents"
