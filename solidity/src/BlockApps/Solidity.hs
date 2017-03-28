{-# LANGUAGE
    DeriveGeneric
  , OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.Solidity where

import Data.Aeson
import Data.Aeson.Casing
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import Data.Foldable
import Data.Int (Int32)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances ()

data SolidityValue
  = SolidityValueAsString Text
  | SolidityBool Bool
  | SolidityArray [SolidityValue]
  | SolidityBytes  ByteString
  | SolidityObject [(Text, SolidityValue)]
  deriving (Eq,Show,Generic)
instance ToJSON SolidityValue where
  toJSON (SolidityValueAsString str) = toJSON str
  toJSON (SolidityBool boolean) = toJSON boolean
  toJSON (SolidityArray array) = toJSON array
  toJSON (SolidityBytes bytes) = object
    [ "type" .= ("Buffer" :: Text)
    , "data" .= ByteString.unpack bytes
    ]
  toJSON (SolidityObject namedItems) =
    object $ map (\(name, value) -> name .= value) namedItems
instance FromJSON SolidityValue where
  parseJSON (String str) = return $ SolidityValueAsString str
  parseJSON (Bool boolean) = return $ SolidityBool boolean
  parseJSON (Array array) = SolidityArray <$> traverse parseJSON (toList array)
  --TODO - figure out how to decode a struct....  it looks to me like it could conflict with thie SolidityBytes thing
  parseJSON (Object obj) = do
    ty <- obj .: "type"
    if ty == ("Buffer" :: Text)
    then do
      bytes <- obj .: "data"
      return $ SolidityBytes (ByteString.pack bytes)
    else
      fail "Failed to parse SolidityBytes"
  parseJSON _ = fail "Failed to parse solidity value"
instance Arbitrary SolidityValue where
  arbitrary = return (SolidityBool True)

data ContractType =
  ContractType {
    contracttypeNames::Map Text Int,
    contracttypeType::Text,
    contracttypeBytes::Word
    } deriving (Eq, Show, Generic)
instance Arbitrary ContractType where arbitrary = genericArbitrary uniform
instance ToJSON ContractType where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON ContractType where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
    
data Xabi = Xabi
  { xabiFuncs :: Map Text Func
  , xabiConstr :: Map Text IndexedXabiType
  , xabiVars :: Map Text VarType
  , xabiTypes :: Map Text ContractType
  } deriving (Eq,Show,Generic)
instance ToJSON Xabi where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Xabi where
  parseJSON =
    withObject "xabi" $ \v ->
    Xabi <$> v .:? "funcs" .!= Map.empty
         <*> v .:? "constr" .!= Map.empty
         <*> v .:? "vars" .!= Map.empty
         <*> v .:? "types" .!= Map.empty
instance Arbitrary Xabi where arbitrary = genericArbitrary uniform
data Func = Func
  { funcArgs :: Map Text IndexedXabiType
  , funcSelector :: Text
  , funcVals :: Map Text IndexedXabiType
  } deriving (Eq,Show,Generic)
instance ToJSON Func where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Func where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Func where arbitrary = genericArbitrary uniform

data XabiType =
  XabiType {
    xabiTypeType::Maybe Text
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
      theType <- v .:? "type"
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


data IndexedXabiType =
  IndexedXabiType {
    indexedXabiTypeIndex::Int32,
    indexedXabiTypeType::XabiType
    } deriving (Eq, Show, Generic)

instance FromJSON IndexedXabiType where
  parseJSON = 
    withObject "xabi" $ \v -> do
      index <-  v .: "index"
      theType <- v .:? "type"
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
  
data VarType =
  VarType {
    varTypeAtBytes::Int32
  , varTypeType::XabiType
    } deriving (Eq, Show, Generic)

instance FromJSON VarType where
  parseJSON =
    withObject "xabi" $ \v -> do
      atBytes <-  v .: "atBytes"
      theType <- v .:? "type"
      typedef <- v .:? "typedef"
      dynamic <- v .:? "dynamic"
      signed <- v .:? "signed"
      bytes <- v .:? "bytes"
      entry <- v .:? "entry"
      length' <- v .:? "length"
      val <- v .:? "value"
      key <- v .:? "key"
      return $ VarType atBytes
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

instance ToJSON VarType where
  toJSON (VarType varTypeAtBytes XabiType{..}) = object
    [ "atBytes" .= varTypeAtBytes
    , "type" .= xabiTypeType
    , "typedef" .= xabiTypeTypedef
    , "dynamic" .= xabiTypeDynamic
    , "signed" .= xabiTypeSigned
    , "bytes" .= xabiTypeBytes
    , "entry" .= xabiTypeEntry
    , "value" .= xabiTypeValue
    , "key" .= xabiTypeKey
    ]




instance Arbitrary VarType where arbitrary = genericArbitrary uniform

