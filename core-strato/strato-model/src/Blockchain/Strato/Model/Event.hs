{-# LANGUAGE DeriveGeneric        #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE RecordWildCards      #-}
{-# LANGUAGE TemplateHaskell      #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Model.Event(
  Event(..)
  ) where

import           Control.DeepSeq
import           GHC.Generics
import           Data.Aeson
import           Test.QuickCheck
import           Test.QuickCheck.Instances()

import           Blockchain.MiscJSON()
import           Blockchain.Strato.Model.Account

data Event =
  Event {
    evContractName    :: String,
    evContractAccount :: Account,
    evName            :: String,
    evArgs            :: [String] -- TODO: probably should use Solidity values here?
    } deriving (Eq, Read, Show, Generic)


instance ToJSON Event where
  toJSON Event{..} = object
    [ "eventContractName" .= evContractName
    , "eventContractAccount" .= evContractAccount
    , "eventName"         .= evName
    , "eventArgs"         .= evArgs
    ]

instance FromJSON Event where
  parseJSON (Object o) = Event
    <$> (o .: "eventContractName")
    <*> (o .: "eventContractAccount")
    <*> (o .: "eventName")
    <*> (o .: "eventArgs")
  parseJSON o = error $ "parseJSON Event: Expected object, got:" ++ show o

instance NFData Event
instance Arbitrary Event where
    arbitrary = applyArbitrary4 Event
