{-# LANGUAGE
    DeriveGeneric
  , OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.Solidity.Xabi.Def where

import Data.Aeson
import Data.Aeson.TH
import Data.Map.Strict (Map)
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances ()

import qualified BlockApps.Solidity.Xabi.Type as Xabi

defAesonOptions::Options
defAesonOptions=defaultOptions{sumEncoding=defaultTaggedObject{tagFieldName="type"}}

data Def =
  Enum {
    names::[Text],
    bytes::Word
    }
  | Struct {
    fields::Map Text Xabi.FieldType,
    bytes::Word
    } deriving (Eq, Show, Generic)

instance Arbitrary Def where arbitrary = genericArbitrary uniform
instance ToJSON Def where
  toJSON = genericToJSON defAesonOptions
instance FromJSON Def where
  parseJSON = genericParseJSON defAesonOptions
