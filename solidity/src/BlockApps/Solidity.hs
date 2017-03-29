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
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances ()

import qualified BlockApps.Solidity.Xabi.Defs as Xabi
import BlockApps.Solidity.Xabi.Type

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





              
data Xabi = Xabi
  { xabiFuncs :: Map Text Func
  , xabiConstr :: Map Text IndexedXabiType
  , xabiVars :: Map Text VarType
  , xabiTypes :: Map Text Xabi.Defs
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

