{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module SolidVM.Solidity.Xabi.Type where

import           Control.Lens              (mapped, (&), (?~))
import           Data.Aeson
import           Data.Int                  (Int32)
import           Data.Swagger
import           Data.Text                 (Text)
import qualified Generic.Random            as GR
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances ()

--import           SolidVM.Solidity.Xabi.Statement

typeAesonOptions::Options
typeAesonOptions=defaultOptions{sumEncoding=defaultTaggedObject{tagFieldName="type"}}


data Type
  = Int {signed::Maybe Bool, bytes::Maybe Int32}
  | String {dynamic::Maybe Bool}
  | Bytes {dynamic::Maybe Bool, bytes:: Maybe Int32}
  | Bool
  | Address
  | Label String
  | Struct { bytes::Maybe Int32, typedef::Text}
  | Enum { bytes::Maybe Int32, typedef::Text, names::Maybe [Text]}
  | Array { entry:: Type, length :: Maybe Word }
  | Contract {typedef::Text}
  | Mapping {dynamic::Maybe Bool, key::Type, value::Type} deriving (Eq, Show, Generic)

instance ToJSON Type where
  toJSON = genericToJSON typeAesonOptions{omitNothingFields = True}
instance FromJSON Type where
  parseJSON = genericParseJSON typeAesonOptions{omitNothingFields = True}
instance Arbitrary Type where arbitrary = GR.genericArbitrary GR.uniform
instance ToSchema Type where
  declareNamedSchema proxy = genericDeclareNamedSchemaUnrestricted defaultSchemaOptions proxy
    & mapped.name ?~ "Solidity type"
    & mapped.schema.description ?~ "Represents a soldity type"
    & mapped.schema.example ?~ toJSON Address
