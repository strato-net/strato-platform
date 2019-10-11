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
import           Data.DeriveTH
import           Test.QuickCheck

import           Blockchain.MiscArbitrary()
import           Blockchain.MiscJSON()
import           Blockchain.Strato.Model.Address

data Event =
  Event {
    evContractName    :: String,
    evContractAddress :: Address,
    evName            :: String,
    evArgs            :: [String] -- TODO: probably should use Solidity values here?
    } deriving (Eq, Read, Show, Generic)


instance ToJSON Event where
  toJSON Event{..} = object
    [ "eventContractName" .= evContractName
    , "eventContractAddress" .= evContractAddress
    , "eventName"         .= evName
    , "eventArgs"         .= evArgs
    ]

instance FromJSON Event where
  parseJSON (Object o) = Event
    <$> (o .: "eventContractName")
    <*> (o .: "eventContractAddress")
    <*> (o .: "eventName")
    <*> (o .: "eventArgs")
  parseJSON o = error $ "parseJSON Event: Expected object, got:" ++ show o

instance NFData Event
derive makeArbitrary ''Event
