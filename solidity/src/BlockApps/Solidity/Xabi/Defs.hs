{-# LANGUAGE
    DeriveGeneric
  , OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.Solidity.Xabi.Defs where

import Data.Aeson
import Data.Aeson.TH
import Data.Map.Strict (Map)
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances ()

import BlockApps.Solidity.Xabi.Type

defsAesonOptions::Options
defsAesonOptions=defaultOptions{sumEncoding=defaultTaggedObject{tagFieldName="type"}}

data Defs =
  Enum {
    names::Map Text Int,
    bytes::Word
    }
  | Struct {
    field::Map Text XabiType,
    bytes::Word
    } deriving (Eq, Show, Generic)
               
instance Arbitrary Defs where arbitrary = genericArbitrary uniform
instance ToJSON Defs where
  toJSON = genericToJSON defsAesonOptions
instance FromJSON Defs where
  parseJSON = genericParseJSON defsAesonOptions






              
