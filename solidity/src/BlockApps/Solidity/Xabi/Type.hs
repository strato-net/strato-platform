{-# LANGUAGE
    DeriveGeneric
  , OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.Solidity.Xabi.Type where

import Data.Aeson
import Data.Aeson.TH
import qualified Data.HashMap.Lazy as HashMap
import Data.Int (Int32)
import Data.Map (Map)
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances ()

typeAesonOptions::Options
typeAesonOptions=defaultOptions{sumEncoding=defaultTaggedObject{tagFieldName="type"}}


data Type =
  Int {signed::Maybe Bool, bytes::Integer}
  | String {dynamic::Bool}
  | Bytes
  | Bool
  | Address
  | Struct {fields::Map Text Type, bytes::Integer, typedef::Text}
  | Enum {names::Map Text Int, bytes::Integer, typedef::Text}
  | Array {dynamic::Bool, length::Maybe Word, entry::Type}
  | Contract {typedef::Text} deriving (Eq, Show, Generic)

instance ToJSON Type where
  toJSON = genericToJSON typeAesonOptions
instance FromJSON Type where
  parseJSON = genericParseJSON typeAesonOptions
instance Arbitrary Type where arbitrary = genericArbitrary uniform


data IndexedType =
  IndexedType {
    indexedTypeIndex::Int32,
    indexedTypeType::Type
    } deriving (Eq, Show, Generic)

instance FromJSON IndexedType where
  parseJSON = 
    withObject "xabi" $ \v -> do
      index <-  v .: "index"
      theType <- parseJSON $ Object $ HashMap.insertWith (const id) "type" "Contract" v
      return $ IndexedType index theType
instance ToJSON IndexedType where
  toJSON (IndexedType indexedTypeIndex theType) =
    let
      Object theMap = toJSON theType
    in
     Object $
     HashMap.insert "index" (toJSON indexedTypeIndex)
     theMap

instance Arbitrary IndexedType where arbitrary = genericArbitrary uniform


data VarType =
  VarType
  { varTypeAtBytes :: Int32
  , varTypePublic :: Maybe Bool
  , varTypeType :: Type
  } deriving (Eq, Show, Generic)

instance FromJSON VarType where
  parseJSON =
    withObject "xabi" $ \v -> do
      atBytes <-  v .: "atBytes"
      public <- v .:? "public"
      theType <- parseJSON $ Object $ HashMap.insertWith (const id) "type" "Contract" v
      return $ VarType atBytes public
        theType

instance ToJSON VarType where
  toJSON (VarType varTypeAtBytes varTypePublic theType) =
    let
      Object theMap = toJSON theType
    in
     Object $
     HashMap.insert "atBytes" (toJSON varTypeAtBytes) $
     HashMap.insert "public" (toJSON varTypePublic)
     theMap



instance Arbitrary VarType where arbitrary = genericArbitrary uniform
