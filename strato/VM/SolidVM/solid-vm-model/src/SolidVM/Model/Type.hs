{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module SolidVM.Model.Type where

import Control.DeepSeq
import Control.Lens (mapped, (&), (?~))
import Data.Aeson hiding (Array, String)
import Data.Binary
import Data.Int (Int32)
import Data.Maybe (fromMaybe)
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

maybeEq :: Eq a => Maybe a -> Maybe a -> Bool
maybeEq a b = fromMaybe True $ (==) <$> a <*> b

typeEquals :: Type -> Type -> Bool
typeEquals (Int s1 b1) (Int s2 b2) = s1 `maybeEq` s2 && b1 `maybeEq` b2
typeEquals (String d1) (String d2) = d1 `maybeEq` d2
typeEquals (Bytes d1 b1) (Bytes d2 b2) = d1 `maybeEq` d2 && b1 `maybeEq` b2
typeEquals (Struct b1 t1) (Struct b2 t2) = b1 `maybeEq` b2 && t1 == t2
typeEquals (Array t1 l1) (Array t2 l2) = t1 `typeEquals` t2 && l1 `maybeEq` l2
typeEquals (Mapping d1 k1 v1) (Mapping d2 k2 v2) = d1 `maybeEq` d2 && k1 `typeEquals` k2 && v1 `typeEquals` v2
typeEquals t1 t2 = t1 == t2

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
      & mapped . schema . example ?~ toJSON Address {isPayable = False}
