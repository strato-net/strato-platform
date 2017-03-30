{-# LANGUAGE
    DeriveGeneric
  , OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.Solidity.Xabi.Type where

import Data.Aeson
import qualified Data.HashMap.Lazy as HashMap
import Data.Int (Int32)
import Data.Map (Map)
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances ()



data Type =
  Int {signed::Bool, bytes::Integer}
  | String {dynamic::Bool}
  | Bytes
  | Bool
  | Address
  | Struct {fields::Map Text Type, bytes::Integer, typedef::Text}
  | Enum {names::Map Text Int, bytes::Integer, typedef::Text}
  | Array {dynamic::Bool, length::Maybe Word, entry::Type}
  | Contract {typedef::Text} deriving (Eq, Show, Generic)

instance FromJSON Type where
instance ToJSON Type where
instance Arbitrary Type where arbitrary = genericArbitrary uniform

{-
data XabiType =
  XabiType {
    xabiTypeType::Text
  , xabiTypeTypedef::Maybe Text
  , xabiTypeDynamic::Maybe Bool
  , xabiTypeSigned::Maybe Bool
  , xabiTypeBytes::Maybe Int32
  , xabiTypeEntry::Maybe XabiType
  , xabiTypeLength::Maybe Word
  , xabiTypeValue::Maybe XabiType
  , xabiTypeKey::Maybe XabiType
    } deriving (Eq, Show, Generic)

instance FromJSON XabiType where
  parseJSON =
    withObject "xabi" $ \v -> do
      theType <- v .:? "type" .!= "Contract"
      typedef <- v .:? "typedef"
      dynamic <- v .:? "dynamic"
      signed <- v .:? "signed"
      bytes <- v .:? "bytes"
      entry <- v .:? "entry"
      length' <- v .:? "length"
      val <- v .:? "value"
      key <- v .:? "key"
      return
        XabiType {
        xabiTypeType = theType,
        xabiTypeTypedef = typedef, 
        xabiTypeDynamic = dynamic, 
        xabiTypeSigned = signed, 
        xabiTypeBytes = bytes, 
        xabiTypeEntry = entry, 
        xabiTypeLength = length',
        xabiTypeValue = val, 
        xabiTypeKey = key
        }

instance ToJSON XabiType where
  toJSON XabiType{..} = object
    [ "type" .= xabiTypeType
    , "typedef" .= xabiTypeTypedef
    , "dynamic" .= xabiTypeDynamic
    , "signed" .= xabiTypeSigned
    , "bytes" .= xabiTypeBytes
    , "entry" .= xabiTypeEntry
    , "value" .= xabiTypeValue
    , "key" .= xabiTypeKey
    ]

instance Arbitrary XabiType where arbitrary = genericArbitrary uniform

-}

data IndexedType =
  IndexedType {
    indexedTypeIndex::Int32,
    indexedTypeType::Type
    } deriving (Eq, Show, Generic)

instance FromJSON IndexedType where
  parseJSON = undefined
instance ToJSON IndexedType where
  toJSON (IndexedType _ _) = undefined

instance Arbitrary IndexedType where arbitrary = genericArbitrary uniform

{-
data IndexedXabiType =
  IndexedXabiType {
    indexedXabiTypeIndex::Int32,
    indexedXabiTypeType::XabiType
    } deriving (Eq, Show, Generic)

instance FromJSON IndexedXabiType where
  parseJSON =
    withObject "xabi" $ \v -> do
      index <-  v .: "index"
      theType <- v .:? "type" .!= "Contract"
      typedef <- v .:? "typedef"
      dynamic <- v .:? "dynamic"
      signed <- v .:? "signed"
      bytes <- v .:? "bytes"
      entry <- v .:? "entry"
      length' <- v .:? "length"
      val <- v .:? "value"
      key <- v .:? "key"
      return $ IndexedXabiType index
        XabiType {
        xabiTypeType = theType,
        xabiTypeTypedef = typedef, 
        xabiTypeDynamic = dynamic, 
        xabiTypeSigned = signed, 
        xabiTypeBytes = bytes, 
        xabiTypeEntry = entry, 
        xabiTypeLength = length',
        xabiTypeValue = val, 
        xabiTypeKey = key
        }


instance ToJSON IndexedXabiType where
  toJSON (IndexedXabiType index XabiType{..}) = object
    [ "index" .= index
    , "type" .= xabiTypeType
    , "typedef" .= xabiTypeTypedef
    , "dynamic" .= xabiTypeDynamic
    , "signed" .= xabiTypeSigned
    , "bytes" .= xabiTypeBytes
    , "entry" .= xabiTypeEntry
    , "value" .= xabiTypeValue
    , "key" .= xabiTypeKey
    ]


instance Arbitrary IndexedXabiType where arbitrary = genericArbitrary uniform

-}

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
      theType <- parseJSON $ Object v
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
