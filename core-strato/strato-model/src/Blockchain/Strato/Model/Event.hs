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


data Event =
  Event {
    evName   :: String,
    evArgs   :: [String] -- TODO: probably think of better types, fields for this
    } deriving (Eq, Read, Show, Generic)


instance ToJSON Event where
  toJSON Event{..} = object
    [ "eventName"       .= evName
    , "eventArgs"       .= evArgs
    ]

instance FromJSON Event where
  parseJSON (Object o) = Event
    <$> (o .: "eventName")
    <*> (o .: "eventArgs")
  parseJSON o = error $ "parseJSON Event: Expected object, got:" ++ show o

instance NFData Event
derive makeArbitrary ''Event
