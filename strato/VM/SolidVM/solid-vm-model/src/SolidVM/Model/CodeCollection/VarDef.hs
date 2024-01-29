{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module SolidVM.Model.CodeCollection.VarDef where

import Control.DeepSeq
import Control.Lens (mapped, (&), (?~))
import Data.Aeson
-- import qualified Data.Map.Strict as M
-- import qualified Data.HashMap.Lazy         as HashMap
import qualified Data.Aeson.KeyMap as KeyMap
import Data.Binary
import Data.Int (Int32)
import Data.Swagger
import GHC.Generics
import qualified Generic.Random as GR
-- import SolidVM.Model.CodeCollection.Statement
import SolidVM.Model.Type
import Test.QuickCheck
import Test.QuickCheck.Instances ()

typeAesonOptions :: Options
typeAesonOptions = defaultOptions

data IndexedType = IndexedType {indexedTypeIndex :: Int32, indexedTypeType :: Type}
  deriving (Eq, Show, Generic, NFData)

-- instance ToJSON Person where
--     -- this generates a Value
--     toJSON (Person name age) =
--         object ["name" .= name, "age" .= age]

--     -- this encodes directly to a bytestring Builder
--     toEncoding (Person name age) =
--         pairs ("name" .= name <> "age" .= age)

instance Binary IndexedType

instance FromJSON IndexedType where
  parseJSON =
    withObject "xabi" $ \v -> do
      index <- v .: "index"
      theType <- parseJSON $ Object $ KeyMap.insertWith (const id) "type" "Contract" v
      return $ IndexedType index theType

instance ToJSON IndexedType where
  toJSON (IndexedType indexedTypeIndex theType) =
    object ["index" .= indexedTypeIndex, "type" .= theType]

instance Arbitrary IndexedType where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema IndexedType where
  declareNamedSchema proxy =
    genericDeclareNamedSchema defaultSchemaOptions proxy
      & mapped . name ?~ "Solidity type"
      & mapped . schema . description ?~ "Represents a soldity type"
      & mapped . schema . example ?~ toJSON (IndexedType 10 (Mapping (Just False) (Account False) (Bytes Nothing Nothing)))

data FieldType = FieldType {fieldTypeAtBytes :: Int32, fieldTypeType :: Type}
  deriving (Eq, Show, Generic, NFData)

instance Binary FieldType

instance FromJSON FieldType where
  parseJSON =
    withObject "xabi" $ \v -> do
      atBytes <- v .: "atBytes"
      theType <- parseJSON $ Object v
      return $ FieldType atBytes theType

instance ToJSON FieldType where
  toJSON FieldType {..} =
    object ["atBytes" .= fieldTypeAtBytes, "type" .= fieldTypeType]

instance Arbitrary FieldType where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema FieldType where
  declareNamedSchema proxy =
    genericDeclareNamedSchema defaultSchemaOptions proxy
      & mapped . name ?~ "FieldType"
      & mapped . schema . description ?~ "Represents a Solidity Field Type"
      & mapped . schema . example ?~ toJSON (FieldType 32 (Account False))
