{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Model.Event
  ( Event (..),
  )
where

import Blockchain.MiscJSON ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Data.Aeson
import Data.Binary
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Arbitrary.Generic
import Test.QuickCheck.Instances ()
import Text.Format

data Event = Event
  { evBlockHash :: Keccak256,
    evTxSender :: Address,
    evContractName :: String,
    evContractAddress :: Address,
    evName :: String,
    evArgs :: [(String, String, String)] -- TODO: probably should use Solidity values here?
  }
  deriving (Eq, Read, Show, Generic)

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
      ++ show evArgs
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
      <$> (o .: "eventBlockHash")
      <*> (o .: "eventTxSender")
      <*> (o .: "eventContractName")
      <*> (o .: "eventContractAddress")
      <*> (o .: "eventName")
      <*> (o .: "eventArgs")
  parseJSON o = error $ "parseJSON Event: Expected object, got:" ++ show o

instance NFData Event

instance Arbitrary Event where
  arbitrary = genericArbitrary
