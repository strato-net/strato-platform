{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module BlockApps.Solidity.Xabi.Type where

import Control.DeepSeq
import Control.Lens (mapped, (&), (?~))
import Data.Aeson
import qualified Data.Aeson as Aeson
import qualified Data.Aeson.KeyMap as KeyMap
import Data.Int (Int32)
import Data.Swagger
import Data.Text (Text)
import GHC.Generics
import qualified Generic.Random as GR
import Test.QuickCheck
import Test.QuickCheck.Instances ()

typeAesonOptions :: Options
typeAesonOptions = defaultOptions

data Type
  = Int {signed :: Maybe Bool, bytes :: Maybe Int32}
  | String {dynamic :: Maybe Bool}
  | Decimal
  | Bytes {dynamic :: Maybe Bool, bytes :: Maybe Int32}
  | Bool
  | Address
  | Account
  | UnknownLabel String
  | Struct {bytes :: Maybe Int32, typedef :: Text}
  | Enum {bytes :: Maybe Int32, typedef :: Text, names :: Maybe [Text]}
  | Array {entry :: Type, length :: Maybe Word}
  | Contract {typedef :: Text}
  | Mapping {dynamic :: Maybe Bool, key :: Type, value :: Type}
  | Variadic
  deriving (Eq, Show, Generic, NFData, Read)

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
      & mapped . schema . example ?~ toJSON Address

data IndexedType = IndexedType {indexedTypeIndex :: Int32, indexedTypeType :: Type}
  deriving (Eq, Show, Generic, NFData, Read)

instance FromJSON IndexedType where
  parseJSON =
    withObject "xabi" $ \v -> do
      index <- v .: "index"
      theType <- parseJSON $ Object $ KeyMap.insertWith (const id) "type" "Contract" v
      return $ IndexedType index theType

instance ToJSON IndexedType where
  toJSON (IndexedType indexedTypeIndex theType) =
    let val = toJSON theType
        theMap = case val of
          Object o -> o
          Aeson.Array _ -> KeyMap.empty
          Aeson.String _ -> KeyMap.empty
          Aeson.Number _ -> KeyMap.empty
          Aeson.Bool _ -> KeyMap.empty
          Aeson.Null -> KeyMap.empty
     in Object $
          KeyMap.insert
            "index"
            (toJSON indexedTypeIndex)
            theMap

instance Arbitrary IndexedType where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema IndexedType where
  declareNamedSchema proxy =
    genericDeclareNamedSchema defaultSchemaOptions proxy
      & mapped . name ?~ "Solidity type"
      & mapped . schema . description ?~ "Represents a soldity type"
      & mapped . schema . example ?~ toJSON (IndexedType 10 (Mapping (Just False) Address (Bytes Nothing Nothing)))

data VarType = VarType
  { varTypeAtBytes :: Int32,
    varTypePublic :: Maybe Bool,
    varTypeConstant :: Maybe Bool,
    varTypeInitialValue :: Maybe String,
    varTypeType :: Type
  }
  deriving (Eq, Show, Generic, NFData, Read)

instance FromJSON VarType where
  parseJSON =
    withObject "xabi" $ \v -> do
      atBytes <- v .: "atBytes"
      public <- v .:? "public"
      constant <- v .:? "constant"
      value <- v .:? "initialValue"
      theType <- parseJSON $ Object $ KeyMap.insertWith (const id) "type" "Contract" v
      return $ VarType atBytes public constant value theType

instance ToJSON VarType where
  toJSON (VarType varTypeAtBytes varTypePublic varTypeConstant varTypeInitialValue theType) =
    let val = toJSON theType
        theMap = case val of
          Object o -> o
          Aeson.Array _ -> KeyMap.empty
          Aeson.String _ -> KeyMap.empty
          Aeson.Number _ -> KeyMap.empty
          Aeson.Bool _ -> KeyMap.empty
          Aeson.Null -> KeyMap.empty
     in Object $
          KeyMap.insert "atBytes" (toJSON varTypeAtBytes) $
            KeyMap.insert "public" (toJSON varTypePublic) $
              KeyMap.insert "constant" (toJSON varTypeConstant) $
                KeyMap.insert "initialValue" (toJSON varTypeInitialValue) $
                  theMap

instance ToSchema VarType where
  declareNamedSchema proxy =
    genericDeclareNamedSchema defaultSchemaOptions proxy
      & mapped . name ?~ "VarType"
      & mapped . schema . description ?~ "Represents a Solidity Variable"
      & mapped . schema . example ?~ toJSON (VarType 16 (Just True) (Just False) (Just "6120418de8a7a0ce3c3a0e3fe907e1351ceb4fe7") Address)

instance Arbitrary VarType where arbitrary = GR.genericArbitrary GR.uniform

data FieldType = FieldType {fieldTypeAtBytes :: Int32, fieldTypeType :: Type}
  deriving (Eq, Show, Generic, NFData, Read)

instance FromJSON FieldType where
  parseJSON =
    withObject "xabi" $ \v -> do
      atBytes <- v .: "atBytes"
      theType <- parseJSON $ Object v
      return $ FieldType atBytes theType

instance ToJSON FieldType where
  toJSON FieldType {..} =
    let val = toJSON fieldTypeType
        theMap = case val of
          Object o -> o
          Aeson.Array _ -> KeyMap.empty
          Aeson.String _ -> KeyMap.empty
          Aeson.Number _ -> KeyMap.empty
          Aeson.Bool _ -> KeyMap.empty
          Aeson.Null -> KeyMap.empty
     in Object $ KeyMap.insert "atBytes" (toJSON fieldTypeAtBytes) theMap

instance Arbitrary FieldType where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema FieldType where
  declareNamedSchema proxy =
    genericDeclareNamedSchema defaultSchemaOptions proxy
      & mapped . name ?~ "FieldType"
      & mapped . schema . description ?~ "Represents a Solidity Field Type"
      & mapped . schema . example ?~ toJSON (FieldType 32 Address)
