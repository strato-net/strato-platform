{-# LANGUAGE
    DataKinds
  , DeriveGeneric
  , FlexibleInstances
  , OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.Solidity.Xabi where

import Control.Applicative
import Data.Aeson
import Data.Aeson.Casing
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Text (Text)
import qualified Data.Text as Text
import Generic.Random.Generic
import GHC.Generics
import Servant.API
import Servant.Docs
import Test.QuickCheck
import Test.QuickCheck.Instances ()

import BlockApps.Ethereum
import qualified BlockApps.Solidity.Xabi.Def as Xabi
import qualified BlockApps.Solidity.Xabi.Type as Xabi

data Xabi = Xabi
  { xabiFuncs :: Map Text Func
  , xabiConstr :: Map Text Xabi.IndexedType
  , xabiVars :: Map Text Xabi.VarType
  , xabiTypes :: Map Text Xabi.Def
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
  { funcArgs :: Map Text Xabi.IndexedType
  , funcSelector :: Text
  , funcVals :: Map Text Xabi.IndexedType
  } deriving (Eq,Show,Generic)
instance ToJSON Func where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON Func where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary Func where arbitrary = genericArbitrary uniform

data ContractDetails = ContractDetails
  { contractdetailsBin :: Text
  , contractdetailsAddress :: Maybe (MaybeNamed Address)
  , contractdetailsBinRuntime :: Text
  , contractdetailsCodeHash :: Keccak256
  , contractdetailsName :: Text
  , contractdetailsXabi :: Xabi
  } deriving (Show,Eq,Generic)
instance ToJSON ContractDetails where
  toJSON ContractDetails{..} = object
    [ "bin" .= contractdetailsBin
    , "address" .= contractdetailsAddress
    , "bin-runtime" .= contractdetailsBinRuntime
    , "codeHash" .= contractdetailsCodeHash
    , "name" .= contractdetailsName
    , "xabi" .= contractdetailsXabi
    ]
instance FromJSON ContractDetails where
  parseJSON = withObject "ContractDetails" $ \obj ->
    ContractDetails
      <$> obj .: "bin"
      <*> obj .:? "address"
      <*> obj .: "bin-runtime"
      <*> obj .: "codeHash"
      <*> obj .: "name"
      <*> obj .: "xabi"
instance ToSample ContractDetails where toSamples _ = noSamples
instance Arbitrary ContractDetails where
  arbitrary = genericArbitrary uniform

data MaybeNamed a = Named Text | Unnamed a deriving (Eq,Show,Generic)
instance ToJSON a => ToJSON (MaybeNamed a) where
  toJSON (Named name) = toJSON name
  toJSON (Unnamed a) = toJSON a
instance FromJSON a => FromJSON (MaybeNamed a) where
  parseJSON x = Unnamed <$> parseJSON x <|> Named <$> parseJSON x
instance Arbitrary a => Arbitrary (MaybeNamed a) where
  arbitrary = oneof
    [ elements [Named "name1", Named "name2", Named "name3"]
    , Unnamed <$> arbitrary
    ]
instance ToHttpApiData (MaybeNamed Address) where
  toUrlPiece (Named name) = name
  toUrlPiece (Unnamed addr) = Text.pack . addressString $ addr
instance FromHttpApiData (MaybeNamed Address) where
  parseUrlPiece txt = case stringAddress (Text.unpack txt) of
    Nothing -> Right $ Named txt
    Just addr -> Right $ Unnamed addr
instance ToSample (MaybeNamed Address) where
  toSamples _ = [("Sample", Unnamed (Address 0xdeadbeef))]
instance ToCapture (Capture "contractAddress" (MaybeNamed Address)) where
  toCapture _ = DocCapture "contractAddress" "an Ethereum address or Contract Name"
