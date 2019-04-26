{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module SolidVM.Solidity.Xabi.VarDef where

import           Control.DeepSeq
import           Control.Lens              (mapped, (&), (?~))
import           Data.Aeson
import           Data.Binary
import qualified Data.HashMap.Lazy         as HashMap
import           Data.Int                  (Int32)
import           Data.Swagger
import qualified Generic.Random            as GR
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances ()

import           SolidVM.Solidity.Xabi.Statement
import           SolidVM.Solidity.Xabi.Type

typeAesonOptions::Options
typeAesonOptions=defaultOptions{sumEncoding=defaultTaggedObject{tagFieldName="type"}}


data IndexedType = IndexedType { indexedTypeIndex::Int32, indexedTypeType::Type }
                 deriving (Eq, Show, Read, Generic, NFData, Binary)

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

instance Arbitrary IndexedType where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema IndexedType where
  declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy
    & mapped.name ?~ "Solidity type"
    & mapped.schema.description ?~ "Represents a soldity type"
    & mapped.schema.example ?~ toJSON (IndexedType 10 (Mapping (Just False) Address (Bytes Nothing Nothing)))

data VarType =
  VarType
  { varTypeAtBytes        :: Int32
  , varTypePublic         :: Maybe Bool
  , varTypeConstant       :: Maybe Bool
  , varTypeInitialValue   :: Maybe Expression
  , varTypeType           :: Type
  } deriving (Eq, Show, Generic, NFData, Binary)
{-
instance FromJSON VarType where
  parseJSON =
    withObject "xabi" $ \v -> do
      atBytes <-  v .: "atBytes"
      public <- v .:? "public"
      constant <- v .:? "constant"
      value <- v .:? "initialValue"
      theType <- parseJSON $ Object $ HashMap.insertWith (const id) "type" "Contract" v
      return $ VarType atBytes public constant value theType

instance ToJSON VarType where
  toJSON (VarType varTypeAtBytes varTypePublic varTypeConstant varTypeInitialValue theType) =
    let
      Object theMap = toJSON theType
    in
     Object $
     HashMap.insert "atBytes" (toJSON varTypeAtBytes) $
     HashMap.insert "public" (toJSON varTypePublic) $
     HashMap.insert "constant" (toJSON varTypeConstant) $
     HashMap.insert "initialValue" (toJSON varTypeInitialValue)
     theMap

instance ToSchema VarType where
  declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy
    & mapped.name ?~ "VarType"
    & mapped.schema.description ?~ "Represents a Solidity Variable"
    & mapped.schema.example ?~ toJSON (VarType 16 (Just True) (Just False) (Just "6120418de8a7a0ce3c3a0e3fe907e1351ceb4fe7") Address)


instance Arbitrary VarType where arbitrary = GR.genericArbitrary GR.uniform
-}
data FieldType = FieldType { fieldTypeAtBytes :: Int32, fieldTypeType :: Type }
               deriving (Eq, Show, Read, Generic, NFData, Binary)

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

instance Arbitrary FieldType where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema FieldType  where
  declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy
    & mapped.name ?~ "FieldType"
    & mapped.schema.description ?~ "Represents a Solidity Field Type"
    & mapped.schema.example ?~ toJSON (FieldType 32 Address)
