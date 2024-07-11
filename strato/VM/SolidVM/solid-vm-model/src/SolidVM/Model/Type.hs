{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module SolidVM.Model.Type where

import Control.DeepSeq
import Control.Lens (mapped, (&), (?~))
import Data.Aeson
import Data.Binary
import Data.Int (Int32)
import Data.Swagger
import GHC.Generics
import qualified Generic.Random as GR
import SolidVM.Model.SolidString
import Test.QuickCheck
import Test.QuickCheck.Instances ()

typeAesonOptions :: Options
typeAesonOptions = defaultOptions

data Type
  = Int {signed :: Maybe Bool, bytes :: Maybe Int32}
  | String {dynamic :: Maybe Bool}
  | Bytes {dynamic :: Maybe Bool, bytes :: Maybe Int32}
  | Decimal
  | Bool
  | Address {isPayable :: Bool}
  | Account {isPayable :: Bool}
  | UnknownLabel SolidString (Maybe SolidString)
  | Struct {bytes :: Maybe Int32, typedef :: SolidString}
  | UserDefined {alias :: SolidString, actual :: Type}
  | Enum {bytes :: Maybe Int32, typedef :: SolidString, names :: Maybe [SolidString]}
  | Error {bytes :: Maybe Int32, typedef :: SolidString}
  | Array {entry :: Type, length :: Maybe Word}
  | Contract {typedef :: SolidString}
  | Mapping {dynamic :: Maybe Bool, key :: Type, value :: Type}
  | Variadic
  deriving (Eq, Show, Generic, NFData)

instance Binary Type

instance ToJSON Type where
  toJSON = genericToJSON typeAesonOptions {omitNothingFields = True}

instance FromJSON Type where
  parseJSON = genericParseJSON typeAesonOptions {omitNothingFields = True}

instance Arbitrary Type where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema Type where
  declareNamedSchema proxy =
    genericDeclareNamedSchemaUnrestricted defaultSchemaOptions proxy
      & mapped . name ?~ "Solidity type"
      & mapped . schema . description ?~ "Represents a soldity type"
      & mapped . schema . example ?~ toJSON Account {isPayable = False}
