{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module SolidVM.Solidity.Xabi.Def where

import           Control.Lens                 (mapped, (&), (?~))
import           Data.Aeson
import           Data.Swagger
import           Data.Text                    (Text)
import qualified Generic.Random               as GR
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()


import qualified SolidVM.Solidity.Xabi.VarDef as Xabi

defAesonOptions :: Options
defAesonOptions = defaultOptions{sumEncoding=defaultTaggedObject{tagFieldName="type"}}

data Def = Enum { names::[Text], bytes::Word }
         | Struct { fields::[(Text, Xabi.FieldType)], bytes::Word }
         | Contract { bytes::Word }
         deriving (Eq, Show, Read, Generic)

instance Arbitrary Def where arbitrary = GR.genericArbitrary GR.uniform
instance ToJSON Def where
  toJSON = genericToJSON defAesonOptions
instance FromJSON Def where
  parseJSON = genericParseJSON defAesonOptions

instance ToSchema Def where
  declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy
    & mapped.name ?~ "TypeDef"
    & mapped.schema.description ?~ "User defined type (Struct or Enum)"
    & mapped.schema.example ?~ toJSON (Enum ["SUCCESS", "FAILURE", "NOT_AUTHORIZED"] 0xdeadbeef)
