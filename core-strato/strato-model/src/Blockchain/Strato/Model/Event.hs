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
    evContractOrganization :: String,
    evContractApplication  :: String,
    evContractName    :: String,
    evContractAccount :: Account,
    evName            :: String,
    evArgs            :: [(String, String)] -- TODO: probably should use Solidity values here?
    } deriving (Eq, Read, Show, Generic)


instance ToJSON Event where
  toJSON Event{..} = object
    [ "eventContractOrganization" .= evContractOrganization
    , "eventContractApplication" .= evContractApplication
    , "eventContractName" .= evContractName
    , "eventContractAccount" .= evContractAccount
    , "eventName"         .= evName
    , "eventArgs"         .= evArgs
    ]

instance FromJSON Event where
  parseJSON (Object o) = Event
    <$> (o .: "eventContractOrganization")
    <*> (o .: "eventContractApplication")
    <*> (o .: "eventContractName")
    <*> (o .: "eventContractAccount")
    <*> (o .: "eventName")
    <*> (o .: "eventArgs")
  parseJSON o = error $ "parseJSON Event: Expected object, got:" ++ show o

instance NFData Event
instance Arbitrary Event where
    arbitrary = Event <$> arbitrary <*> arbitrary  <*> arbitrary  
                        <*> arbitrary  <*> arbitrary  <*> arbitrary
