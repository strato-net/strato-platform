{-# LANGUAGE
    DeriveGeneric
  , OverloadedStrings
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
  deriving (Eq,Show,Generic)
instance ToJSON SolidityValue where
  toJSON (SolidityValueAsString str) = toJSON str
  toJSON (SolidityBool boolean) = toJSON boolean
  toJSON (SolidityArray array) = toJSON array
  toJSON (SolidityBytes bytes) = object
    [ "type" .= ("Buffer" :: Text)
    , "data" .= ByteString.unpack bytes
    ]
instance FromJSON SolidityValue where
  parseJSON (String str) = return $ SolidityValueAsString str
  parseJSON (Bool boolean) = return $ SolidityBool boolean
  parseJSON (Array array) = SolidityArray <$> traverse parseJSON (toList array)
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

data Xabi = Xabi
  { xabiFuncs :: Map Text Func
  , xabiConstr :: Map Text IndexedXabiType
  , xabiVars :: Map Text Var
  } deriving (Eq,Show,Generic)
instance ToJSON Xabi where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Xabi where
  parseJSON =
    withObject "xabi" $ \v ->
    Xabi <$> v .:? "funcs" .!= Map.empty
         <*> v .:? "constr" .!= Map.empty
         <*> v .:? "vars" .!= Map.empty
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
  , xabiTypeVal::Maybe XabiType
  , xabiTypeKey::Maybe XabiType
    } deriving (Eq, Show, Generic)

instance FromJSON XabiType where
  parseJSON _ = undefined
instance ToJSON XabiType where
  toJSON = undefined

instance Arbitrary XabiType where arbitrary = genericArbitrary uniform


data IndexedXabiType =
  IndexedXabiType {
    indexedXabiTypeIndex::Int32,
    indexedXabiTypeType::XabiType
    } deriving (Eq, Show, Generic)

instance FromJSON IndexedXabiType where
  parseJSON _ = undefined
instance ToJSON IndexedXabiType where
  toJSON = undefined
instance Arbitrary IndexedXabiType where arbitrary = genericArbitrary uniform
  
data VarType =
  VarType {
    varTypeType::XabiType
  , varTypeAtBytes::Int32
    }



data Var = Var
  { varAtBytes :: Int32
  , varType :: Maybe Text
  , varTypedef :: Maybe Text
  , varDynamic :: Maybe Bool
  , varSigned :: Maybe Bool
  , varBytes :: Maybe Int32
  , varEntry :: Maybe XabiType
  , varVal :: Maybe XabiType
  , varKey :: Maybe XabiType
  } deriving (Eq,Show,Generic)


             
instance ToJSON Var where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Var where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Var where arbitrary = genericArbitrary uniform
