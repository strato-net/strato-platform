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
import           Test.QuickCheck.Arbitrary.Generic
import           Test.QuickCheck.Instances()

import           Blockchain.MiscJSON()
import           Blockchain.Strato.Model.Account
import           Text.Format

data Event =
  Event {
    evContractOrganization :: String,
    evContractApplication  :: String,
    evContractName    :: String,
    evContractAccount :: Account,
    evName            :: String,
    evArgs            :: [(String, String)] -- TODO: probably should use Solidity values here?
    } deriving (Eq, Read, Show, Generic)

instance Format Event where
  format Event{..} =
    "evContractOrganization: " ++ evContractOrganization ++ "\n" ++
    "evContractApplication: " ++ evContractApplication ++ "\n" ++
    "evContractName: " ++ evContractName ++ "\n" ++
    "evContractAccount: " ++ format evContractAccount ++ "\n" ++
    "evName: " ++ evName ++ "\n" ++
    "evArgs: " ++ show evArgs ++ "\n"
    

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
  arbitrary = genericArbitrary
  
