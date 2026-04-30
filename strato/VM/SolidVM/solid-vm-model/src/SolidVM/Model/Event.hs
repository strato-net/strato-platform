{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module SolidVM.Model.Event
  ( Event (..),
    eventArgValueString,
    eventArgValue,
    eventArgName,
    eventArgType,
  )
where

import Blockchain.MiscJSON ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Data.Aeson hiding (Value)
import Data.Binary
import GHC.Generics
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value (Value (..))
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Text.Format

-- A SolidVM event emitted from a contract.
--
-- Each entry in 'evArgs' is @(argName, argValue, argValueRendered, argType)@:
--   * argName: parameter name from the event declaration
--   * argValue: typed Value captured at emit time, used by consumers that need
--     type fidelity (e.g. canonical RLP encoding for the receipts trie)
--   * argValueRendered: pre-rendered string form of argValue, computed inside
--     MonadSM at emit time. Preserved for legacy display paths (EventDB SQL
--     persistence, RPC responses) that show event args as strings.
--   * argType: SolidVM type from the event declaration
data Event = Event
  { evBlockHash :: Keccak256,
    evTxSender :: Address,
    evContractName :: String,
    evContractAddress :: Address,
    evName :: String,
    evArgs :: [(String, Value, String, SVMType.Type)]
  }
  deriving (Eq, Show, Generic)

eventArgName :: (String, Value, String, SVMType.Type) -> String
eventArgName (n, _, _, _) = n

eventArgValue :: (String, Value, String, SVMType.Type) -> Value
eventArgValue (_, v, _, _) = v

eventArgValueString :: (String, Value, String, SVMType.Type) -> String
eventArgValueString (_, _, s, _) = s

eventArgType :: (String, Value, String, SVMType.Type) -> SVMType.Type
eventArgType (_, _, _, t) = t

instance Format Event where
  format Event {..} =
    "evBlockHash: " ++ format evBlockHash ++ "\n"
      ++ "evTxSender: "
      ++ format evTxSender
      ++ "evContractName: "
      ++ evContractName
      ++ "\n"
      ++ "evContractAccount: "
      ++ format evContractAddress
      ++ "\n"
      ++ "evName: "
      ++ evName
      ++ "\n"
      ++ "evArgs: "
      ++ show [(n, s) | (n, _, s, _) <- evArgs]
      ++ "\n"

instance Binary Event

instance ToJSON Event where
  toJSON Event {..} =
    object
      [ "eventBlockHash" .= evBlockHash,
        "eventTxSender" .= evTxSender,
        "eventContractName" .= evContractName,
        "eventContractAddress" .= evContractAddress,
        "eventName" .= evName,
        "eventArgs" .= evArgs
      ]

instance FromJSON Event where
  parseJSON (Object o) =
    Event
      <$> o .: "eventBlockHash"
      <*> o .: "eventTxSender"
      <*> o .: "eventContractName"
      <*> o .: "eventContractAddress"
      <*> o .: "eventName"
      <*> o .: "eventArgs"
  parseJSON o = error $ "parseJSON Event: Expected object, got:" ++ show o

instance NFData Event

instance Arbitrary Event where
  arbitrary = do
    bh <- arbitrary
    sender <- arbitrary
    cn <- arbitrary
    ca <- arbitrary
    nm <- arbitrary
    args <- listOf $ do
      n <- arbitrary
      s <- arbitrary
      t <- arbitrary
      pure (n, SInteger 0, s, t)
    pure $ Event bh sender cn ca nm args
