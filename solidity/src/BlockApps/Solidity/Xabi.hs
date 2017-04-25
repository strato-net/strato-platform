{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module BlockApps.Solidity.Xabi where

import           Control.Applicative
import           Control.Lens                 (mapped, (&), (?~))
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (camelCase, dropFPrefix)
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as Map
import           Data.Proxy
import           Data.Swagger
import           Data.Swagger.Internal.Schema (named)
import           Data.Text                    (Text)
import qualified Data.Text                    as Text
import           Generic.Random.Generic
import           GHC.Generics
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()

import           BlockApps.Ethereum
import qualified BlockApps.Solidity.Xabi.Def  as Xabi
import qualified BlockApps.Solidity.Xabi.Type as Xabi hiding (Enum)

data Xabi = Xabi
  { xabiFuncs  :: Map Text Func
  , xabiConstr :: Map Text Xabi.IndexedType
  , xabiVars   :: Map Text Xabi.VarType
  , xabiTypes  :: Map Text Xabi.Def
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

instance ToSchema Xabi where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Xabi schema"
    & mapped.schema.description ?~ "Xabi types"
    & mapped.schema.example ?~ toJSON sampleXabi
    where
      sampleXabi :: Xabi
      sampleXabi = Xabi
        { xabiFuncs = Map.fromList
          [ ("get", Func {funcArgs = Map.fromList [], funcVals = Map.fromList [("#0",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]})
          , ("set", Func {funcArgs = Map.fromList [("x",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})], funcVals = Map.fromList []})
          ]
        , xabiConstr = Map.fromList []
        , xabiVars = Map.fromList [("storedData",Xabi.VarType {varTypeAtBytes = 0, varTypePublic = Just False, varTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
        , xabiTypes = Map.fromList [("SimpleStorage", Xabi.Enum {bytes = 0, names = ["SUCCESS", "ERROR"]})]
        }
--------------------------------------------------------------------------------

data Func = Func
  { funcArgs :: Map Text Xabi.IndexedType
  , funcVals :: Map Text Xabi.IndexedType
  } deriving (Eq,Show,Generic)

instance ToJSON Func where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON Func where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance Arbitrary Func where arbitrary = genericArbitrary uniform

instance ToSchema Func where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Function Type"
    & mapped.schema.description ?~ "Xabi Function Type"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: Func
      ex = Func
        { funcArgs = Map.fromList [("userAddress", Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
        , funcVals = Map.fromList [("#0",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
        }


data Modifier = Modifier
  { modifierArgs     :: Map Text Xabi.IndexedType
  , modifierSelector :: Text
  , modifierVals     :: Map Text Xabi.IndexedType
  } deriving (Eq,Show,Generic)

newtype Event = Event { eventLogs :: Map Text Xabi.IndexedType }
              deriving (Eq,Show,Generic)

data Using = Using {} deriving (Eq,Show,Generic)


data ContractDetails = ContractDetails
  { contractdetailsBin        :: Text
  , contractdetailsAddress    :: Maybe (MaybeNamed Address)
  , contractdetailsBinRuntime :: Text
  , contractdetailsCodeHash   :: Keccak256
  , contractdetailsName       :: Text
  , contractdetailsXabi       :: Xabi
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

instance ToSchema ContractDetails where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "ContractDetails"
    & mapped.schema.description ?~ "Returned data from contract creation."
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: ContractDetails
      ex = ContractDetails
        { contractdetailsBin = "ContractBin"
        , contractdetailsAddress = Just (Unnamed (Address 0xdeadbeef))
        , contractdetailsBinRuntime = "ContractRuntime"
        , contractdetailsCodeHash = keccak256 "digest"
        , contractdetailsName = "DetailsName"
        , contractdetailsXabi = sampleXabi
        }
      sampleXabi :: Xabi
      sampleXabi = Xabi
        { xabiFuncs = Map.fromList
          [ ("get", Func {funcArgs = Map.fromList [], funcVals = Map.fromList [("#0",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]})
          , ("set", Func {funcArgs = Map.fromList [("x",Xabi.IndexedType {indexedTypeIndex = 0, indexedTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})], funcVals = Map.fromList []})
          ]
        , xabiConstr = Map.fromList []
        , xabiVars = Map.fromList [("storedData",Xabi.VarType {varTypeAtBytes = 0, varTypePublic = Just False, varTypeType = Xabi.Int {signed = Just False, bytes = Just 32}})]
        , xabiTypes = Map.fromList [("SimpleStorage", Xabi.Enum {bytes = 0, names = ["SUCCESS", "ERROR"]})]
        }

--------------------------------------------------------------------------------

data MaybeNamed a = Named Text | Unnamed a deriving (Eq,Show,Generic)

instance ToJSON a => ToJSON (MaybeNamed a) where
  toJSON (Named _name) = toJSON _name
  toJSON (Unnamed a)   = toJSON a

instance FromJSON a => FromJSON (MaybeNamed a) where
  parseJSON x = Unnamed <$> parseJSON x <|> Named <$> parseJSON x

instance Arbitrary a => Arbitrary (MaybeNamed a) where
  arbitrary = oneof
    [ elements [Named "name1", Named "name2", Named "name3"]
    , Unnamed <$> arbitrary
    ]

instance ToHttpApiData (MaybeNamed Address) where
  toUrlPiece (Named _name)  = _name
  toUrlPiece (Unnamed addr) = Text.pack . addressString $ addr

instance FromHttpApiData (MaybeNamed Address) where
  parseUrlPiece txt = case stringAddress (Text.unpack txt) of
    Nothing   -> Right $ Named txt
    Just addr -> Right $ Unnamed addr

instance ToSample (MaybeNamed Address) where
  toSamples _ = [("Sample", Unnamed (Address 0xdeadbeef))]

instance ToCapture (Capture "contractAddress" (MaybeNamed Address)) where
  toCapture _ = DocCapture "contractAddress" "an Ethereum address or Contract Name"

instance ToParamSchema (MaybeNamed Address) where
  toParamSchema _ = toParamSchema (Proxy :: Proxy Address)

instance ToSchema (MaybeNamed Address) where
  declareNamedSchema = pure . named "MaybeNamed Address" . paramSchemaToSchema

soliditySchemaOptions :: SchemaOptions
soliditySchemaOptions = SchemaOptions
  { fieldLabelModifier = camelCase . dropFPrefix
  , constructorTagModifier = id
  , datatypeNameModifier = id
  , allNullaryToStringTag = True
  , unwrapUnaryRecords = True
  }
