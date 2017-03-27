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
  , xabiConstr :: Map Text Arg
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
  { funcArgs :: Map Text Arg
  , funcSelector :: Text
  , funcVals :: Map Text Val
  } deriving (Eq,Show,Generic)
instance ToJSON Func where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Func where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Func where arbitrary = genericArbitrary uniform
data Arg = Arg
  { argIndex :: Int32
  , argType :: Maybe Text
  , argTypedef :: Maybe Text
  , argDynamic :: Maybe Bool
  , argBytes :: Maybe Int32
  , argEntry :: Maybe Entry
  } deriving (Eq,Show,Generic)
instance ToJSON Arg where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Arg where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Arg where arbitrary = genericArbitrary uniform
data Entry = Entry
  { entryBytes :: Int32
  , entryType :: Text
  } deriving (Eq,Show,Generic)
instance ToJSON Entry where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Entry where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Entry where arbitrary = genericArbitrary uniform
data Val = Val
  { valIndex :: Int32
  , valType :: Maybe Text
  , valTypedef :: Maybe Text
  , valDynamic :: Maybe Bool
  , valBytes :: Maybe Int32
  , valEntry :: Maybe Entry
  } deriving (Eq,Show,Generic)
instance ToJSON Val where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Val where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Val where arbitrary = genericArbitrary uniform
data Var = Var
  { varAtBytes :: Int32
  , varType :: Maybe Text
  , varTypedef :: Maybe Text
  , varDynamic :: Maybe Bool
  , varSigned :: Maybe Bool
  , varBytes :: Maybe Int32
  , varEntry :: Maybe Entry
  , varVal :: Maybe SimpleVar
  , varKey :: Maybe SimpleVar
  } deriving (Eq,Show,Generic)
instance ToJSON Var where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Var where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Var where arbitrary = genericArbitrary uniform
data SimpleVar = SimpleVar
  { simplevarType :: Text
  , simplevarBytes :: Maybe Int32
  -- , simplevarTypedef :: Maybe Text -- TODO: Do we need this?
  , simplevarDynamic :: Maybe Bool
  , simplevarSigned :: Maybe Bool
  , simplevarEntry :: Maybe Entry
  } deriving (Eq,Show,Generic)
instance ToJSON SimpleVar where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON SimpleVar where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary SimpleVar where arbitrary = genericArbitrary uniform
