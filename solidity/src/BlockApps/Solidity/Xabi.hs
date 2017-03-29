{-# LANGUAGE
    DeriveGeneric
  , OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.Solidity.Xabi where

import Data.Aeson
import Data.Aeson.Casing
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances ()

import qualified BlockApps.Solidity.Xabi.Defs as Xabi
import BlockApps.Solidity.Xabi.Type

              
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

