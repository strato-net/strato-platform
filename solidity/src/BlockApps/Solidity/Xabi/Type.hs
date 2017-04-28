{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module BlockApps.Solidity.Xabi.Type where

import           Control.Lens              (mapped, (&), (?~))
import           Data.Aeson
import           Data.Aeson.TH
import qualified Data.HashMap.Lazy         as HashMap
import           Data.Int                  (Int32)
import           Data.Swagger
import           Data.Text                 (Text)
import           Generic.Random.Generic
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances ()

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
  | Enum { bytes::Maybe Int32, typedef::Text}
  | Array {dynamic::Maybe Bool, length::Maybe Word, entry::Type}
  | Contract {typedef::Text}
  | Mapping {dynamic::Maybe Bool, key::Type, value::Type} deriving (Eq, Show, Generic)

instance ToJSON Type where
  toJSON = genericToJSON typeAesonOptions{omitNothingFields = True}
instance FromJSON Type where
  parseJSON = genericParseJSON typeAesonOptions{omitNothingFields = True}
instance Arbitrary Type where arbitrary = genericArbitrary uniform
instance ToSchema Type where
  declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy
    & mapped.name ?~ "Solidity type"
    & mapped.schema.description ?~ "Represents a soldity type"
    & mapped.schema.example ?~ toJSON Address

data IndexedType = IndexedType { indexedTypeIndex::Int32, indexedTypeType::Type }
                 deriving (Eq, Show, Generic)

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

instance ToSchema IndexedType where
  declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy
    & mapped.name ?~ "Solidity type"
    & mapped.schema.description ?~ "Represents a soldity type"
    & mapped.schema.example ?~ toJSON (IndexedType 10 (Mapping (Just False) Address (Bytes Nothing Nothing)))


data VarType =
  VarType
  { varTypeAtBytes :: Int32
  , varTypePublic  :: Maybe Bool
  , varTypeType    :: Type
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

instance ToSchema VarType where
  declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy
    & mapped.name ?~ "VarType"
    & mapped.schema.description ?~ "Represents a Solidity Variable"
    & mapped.schema.example ?~ toJSON (VarType 16 (Just True) Address)


instance Arbitrary VarType where arbitrary = genericArbitrary uniform

data FieldType = FieldType { fieldTypeAtBytes :: Int32, fieldTypeType :: Type }
               deriving (Eq, Show, Generic)

instance FromJSON FieldType where
  parseJSON =
    withObject "xabi" $ \v -> do
      atBytes <-  v .: "atBytes"
      theType <- parseJSON $ Object v
      return $ FieldType atBytes theType

instance ToJSON FieldType where
  toJSON FieldType{..} =
    let
      Object theMap = toJSON fieldTypeType
    in
      Object $ HashMap.insert "atBytes" (toJSON fieldTypeAtBytes) theMap

instance Arbitrary FieldType where arbitrary = genericArbitrary uniform

instance ToSchema FieldType  where
  declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy
    & mapped.name ?~ "FieldType"
    & mapped.schema.description ?~ "Represents a Solidity Field Type"
    & mapped.schema.example ?~ toJSON (FieldType 32 Address)
