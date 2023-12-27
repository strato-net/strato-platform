{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Bloc.API.Contracts where

import Bloc.API.SwaggerSchema
import Bloc.API.Utils
import BlockApps.Solidity.SolidityValue
import BlockApps.Solidity.Xabi
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Keccak256
import Control.Lens (mapped, (&), (?~))
import Data.Aeson
import Data.Aeson.Casing
import Data.Int (Int64)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Proxy
import Data.Source.Annotation
import Data.Source.Map
import Data.Source.Position
import Data.String (IsString (..))
import Data.Text (Text)
import qualified Data.Text as Text
import GHC.Generics
import qualified Generic.Random as GR
import Servant.API
import Servant.Docs
import SolidVM.Model.CodeCollection.Contract
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Web.FormUrlEncoded hiding (fieldLabelModifier)

--------------------------------------------------------------------------------

-- | Routes and types

--------------------------------------------------------------------------------
type GetContracts =
  "contracts"
    :> QueryParam "name" Text
    :> QueryParam "offset" Integer
    :> QueryParam "limit" Integer
    :> QueryParam "chainid" ChainId
    :> Get '[JSON] GetContractsResponse

instance ToParam (QueryParam "limit" Integer) where
  toParam _ = DocQueryParam "limit" [] "Maximum number of entries to return" Normal

data AddressCreatedAt = AddressCreatedAt
  { createdAt :: Int64,
    address :: Address,
    chainId :: Maybe ChainId
  }
  deriving (Eq, Show, Generic)

instance ToJSON AddressCreatedAt

instance FromJSON AddressCreatedAt

instance Arbitrary AddressCreatedAt where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema AddressCreatedAt where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Address Created At"
      & mapped . schema . description ?~ "Address and its creation time (POSIX)"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: AddressCreatedAt
      ex =
        AddressCreatedAt
          { createdAt = 1494448021000,
            address = Address 0xdeadbeef,
            chainId = Nothing
          }

newtype GetContractsResponse = GetContractsResponse
  {unContracts :: Map Text [AddressCreatedAt]}
  deriving (Eq, Show, Generic)

instance ToSchema GetContractsResponse where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Get Contract Response"
      & mapped . schema . description ?~ "Response to Get Contracts endpoint"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: GetContractsResponse
      ex =
        GetContractsResponse
          { unContracts = Map.fromList [("MySampleContract", [AddressCreatedAt 1976 (Address 0xdeadbeef) Nothing])]
          }

instance ToJSON GetContractsResponse where
  toJSON = toJSON . unContracts

instance FromJSON GetContractsResponse where
  parseJSON = fmap GetContractsResponse . parseJSON

instance Arbitrary GetContractsResponse where arbitrary = GR.genericArbitrary GR.uniform

instance ToSample GetContractsResponse where
  toSamples _ =
    singleSample $
      GetContractsResponse $
        Map.singleton
          "Sample"
          [ AddressCreatedAt
              { address = Address 0x309e10eddc6333b82889bfc25a2b107b9c2c9a8c,
                createdAt = 100,
                chainId = Nothing
              },
            AddressCreatedAt
              { address = Address 0x409e10eddc6333b82889bfc25a2b107b9c2c9a8d,
                createdAt = 101,
                chainId = Nothing
              }
          ]

--------------------------------------------------------------------------------

type GetContractsData =
  "contracts"
    :> Capture "contractName" ContractName
    :> Get '[JSON] [Address]

-- GET /contracts/:contractName/:contractAddress.:extension? TODO: Check .extension
type GetContractsContract =
  "contracts"
    :> Capture "contractName" ContractName
    :> Capture "contractAddress" Address
    :> QueryParam "chainid" ChainId
    :> Get '[JSON] Contract

instance ToSample Contract where
  toSamples _ =
    singleSample $
      Contract
        { _contractName = "SimpleStorage",
          _parents = [],
          _constants = Map.empty,
          _storageDefs = Map.empty,
          _userDefined = Map.empty,
          _enums = Map.empty,
          _structs = Map.empty,
          _errors = Map.empty,
          _events = Map.empty,
          _functions = Map.empty,
          _constructor = Nothing,
          _modifiers = Map.empty,
          _usings = Map.empty,
          _contractType = ContractType,
          _importedFrom = Nothing,
          _contractContext = SourceAnnotation (SourcePosition "SimpleStorage.sol" 1 1) (SourcePosition "SimpleStorage.sol" 1 2) ()
        }

--------------------------------------------------------------------------------
type GetContractsState =
  "contracts"
    :> Capture "contractName" ContractName
    :> Capture "contractAddress" Address
    :> "state"
    :> QueryParam "chainid" ChainId
    :> QueryParam "name" Text
    :> QueryParam "count" Integer
    :> QueryParam "offset" Integer
    :> QueryFlag "length"
    :> Get '[JSON] GetContractsStateResponses -- change to HTML

instance ToParam (QueryParam "name" Text) where
  toParam _ = DocQueryParam "name" [] "Names of contract variables" Normal

instance ToParam (QueryParam "count" Integer) where
  toParam _ = DocQueryParam "count" [] "Length of contract array slice" Normal

instance ToParam (QueryParam "offset" Integer) where
  toParam _ = DocQueryParam "offset" [] "Starting index of contract array slice" Normal

instance ToParam (QueryFlag "length") where
  toParam _ =
    DocQueryParam "length" ["0", "1", ""] "flag for resolving a transaction result" Flag

type GetContractsStateResponses = Map Text SolidityValue -- Should be solidity values but we have problems with parsing, e.g. FromJSON with the current format

instance ToSample GetContractsStateResponses where toSamples _ = noSamples

data PostContractsBatchStatesRequest = PostContractsBatchStatesRequest
  { postcontractsbatchstatesrequestContractName :: ContractName,
    postcontractsbatchstatesrequestAddress :: Address,
    postcontractsbatchstatesrequestChainid :: Maybe ChainId, -- lowercase `i` for camelCase JSON instances
    postcontractsbatchstatesrequestVarName :: Maybe Text,
    postcontractsbatchstatesrequestCount :: Maybe Integer,
    postcontractsbatchstatesrequestOffset :: Maybe Integer,
    postcontractsbatchstatesrequestLength :: Maybe Bool
  }
  deriving (Eq, Show, Generic)

instance Arbitrary PostContractsBatchStatesRequest where arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON PostContractsBatchStatesRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostContractsBatchStatesRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostContractsBatchStatesRequest where
  toSamples _ = noSamples

instance ToSchema PostContractsBatchStatesRequest where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Get Contracts States"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: PostContractsBatchStatesRequest
      ex =
        PostContractsBatchStatesRequest
          { postcontractsbatchstatesrequestContractName = ContractName "MySampleContract",
            postcontractsbatchstatesrequestAddress = 0xdeadbeef,
            postcontractsbatchstatesrequestChainid = Nothing,
            postcontractsbatchstatesrequestVarName = Nothing,
            postcontractsbatchstatesrequestCount = Nothing,
            postcontractsbatchstatesrequestOffset = Nothing,
            postcontractsbatchstatesrequestLength = Nothing
          }

type PostContractsBatchStates =
  "contracts"
    :> "states"
    :> ReqBody '[JSON] [PostContractsBatchStatesRequest]
    :> Post '[JSON] [GetContractsStateResponses]

type GetContractsDetails =
  "contracts"
    :> "contract"
    :> Capture "contractAddress" Address
    :> "details"
    :> QueryParam "chainid" ChainId
    :> Get '[JSON] Contract -- change to HTML

--instance {-# OVERLAPPING #-} ToSchema GetContractsStateResponses where
--  declareNamedSchema = pure . pure $ NamedSchema (Just "Get Contract States Response") $ mempty
--    & description ?~ "Response to the Get Cotnracts State route"
--    & example ?~ toJSON ex
--    where
--      ex :: GetContractsStateResponses
--      ex = Map.fromList [("willRain", SolidityBool False)]

--------------------------------------------------------------------------------

-- GET /contracts/:contractName/:contractAddress/functions
type GetContractsFunctions =
  "contracts"
    :> Capture "contractName" ContractName
    :> Capture "contractAddress" Address
    :> QueryParam "chainid" ChainId
    :> "functions"
    :> Get '[JSON] [FunctionName]

newtype FunctionName = FunctionName Text deriving (Eq, Show, Generic)

instance ToSample FunctionName where
  toSamples _ =
    samples
      [FunctionName _name | _name <- ["functionCall1", "functionCall2"]]

instance FromJSON FunctionName where
  parseJSON = fmap FunctionName . parseJSON

instance ToJSON FunctionName where
  toJSON (FunctionName _name) = toJSON _name

instance Arbitrary FunctionName where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema FunctionName where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Function Name"
      & mapped . schema . example ?~ toJSON (FunctionName "fireMissiles")

--------------------------------------------------------------------------------

-- GET /contracts/:contractName/:contractAddress/symbols
type GetContractsSymbols =
  "contracts"
    :> Capture "contractName" ContractName
    :> Capture "contractAddress" Address
    :> QueryParam "chainid" ChainId
    :> "symbols"
    :> Get '[JSON] [SymbolName]

--------------------------------------------------------------------------------

-- GET /contracts/:contractName/:contractAddress/enum/:enumName
type GetContractsEnum =
  "contracts"
    :> Capture "contractName" ContractName
    :> Capture "contractAddress" Address
    :> "enum"
    :> Capture "enumName" EnumName
    :> QueryParam "chainid" ChainId
    :> Get '[JSON] [EnumValue]

newtype EnumName = EnumName {getEnumName :: Text} deriving (Eq, Show, Generic)

newtype EnumValue = EnumValue {getEnumValue :: Text} deriving (Eq, Show, Generic)

instance ToCapture (Capture "enumName" EnumName) where
  toCapture _ = DocCapture "enumName" "the name of a user defined enum type"

instance ToSample EnumName where
  toSamples _ = singleSample (EnumName "TrafficLight")

instance ToSample EnumValue where
  toSamples _ = samples (EnumValue <$> ["Red", "Yellow", "Green"])

instance ToHttpApiData EnumName where
  toUrlPiece = getEnumName

instance FromHttpApiData EnumName where
  parseUrlPiece = Right . EnumName

instance Arbitrary EnumValue where
  arbitrary = elements (EnumValue <$> ["Red", "Yellow", "Green"])

instance FromJSON EnumValue where parseJSON = fmap EnumValue . parseJSON

instance ToJSON EnumValue where toJSON = toJSON . getEnumValue

instance ToSchema EnumValue where
  -- instance ToSchema FunctionName where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Enum Value"
      & mapped . schema . example ?~ toJSON (EnumValue "Red")

instance ToParamSchema EnumName

--------------------------------------------------------------------------------
-- GET /contracts/:contractName/:contractAddress/state/:mapping/:key
type GetContractsStateMapping =
  "contracts"
    :> Capture "contractName" ContractName
    :> Capture "contractAddress" Address
    :> "state"
    :> Capture "mapping" SymbolName
    :> Capture "key" Text
    :> QueryParam "chainid" ChainId
    :> Get '[JSON] GetContractsStateMappingResponse

instance ToCapture (Capture "key" Text) where
  toCapture _ = DocCapture "key" "a mapping key"

instance ToCapture (Capture "mapping" SymbolName) where
  toCapture _ = DocCapture "mapping" "the mapping's name"

type GetContractsStateMappingResponse =
  Map Text (Map Text SolidityValue)

instance ToSample GetContractsStateMappingResponse where
  toSamples _ = noSamples

instance {-# OVERLAPPING #-} ToSchema GetContractsStateMappingResponse where
  declareNamedSchema =
    pure . pure $
      NamedSchema (Just "Get Contract States Mapping Response") $
        mempty
          & description ?~ "Response to the Get Cotnracts State Mapping route"
          & example ?~ toJSON ex
    where
      ex :: GetContractsStateResponses
      ex = Map.fromList [("willRain", SolidityBool False)]

--------------------------------------------------------------------------------
-- GET /contracts/:contractName/all/states/
type GetContractsStates =
  "contracts"
    :> Capture "contractName" ContractName
    :> "all"
    :> "states"
    :> Get '[JSON] [GetContractsStatesResponse]

type GetContractsStatesResponse = Map Address (Map Text SolidityValue)

instance ToSample GetContractsStatesResponse where
  toSamples _ = noSamples

--instance ToSchema GetContractsStatesResponse where
--  declareNamedSchema = pure . pure $ NamedSchema (Just "Get Contract States Response") $ mempty
--    & description ?~ "Response to the Get Cotnracts State route"
--    & example ?~ toJSON ex
--    where
--      ex :: [GetContractsStatesResponse]
--      ex = [Map.fromList [(Address 0xdeadbeef, Map.fromList [("it will rain",SolidityBool False)])]]

--------------------------------------------------------------------------------
-- POST /contracts/compile
type PostContractsCompile =
  "contracts"
    :> "compile"
    :> ReqBody '[JSON] [PostCompileRequest]
    :> Post '[JSON] [PostCompileResponse]

data PostCompileRequest = PostCompileRequest
  { postcompilerequestContractName :: Maybe Text,
    postcompilerequestSource :: SourceMap,
    postcompilerequestVm :: Maybe Text
  }
  deriving (Eq, Show, Generic)

instance Arbitrary PostCompileRequest where arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON PostCompileRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostCompileRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostCompileRequest where
  toSamples _ = noSamples

instance ToSchema PostCompileRequest where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Post Compile Request"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: PostCompileRequest
      ex =
        PostCompileRequest
          { postcompilerequestContractName = Just "MySampleContract",
            postcompilerequestSource = unnamedSource "contract MySampleContract { ...} ",
            postcompilerequestVm = Just "SolidVM"
          }

data PostCompileResponse = PostCompileResponse
  { postcompileresponseContractName :: Text,
    postcompileresponseCodeHash :: Keccak256
  }
  deriving (Eq, Show, Generic)

instance ToJSON PostCompileResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostCompileResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostCompileResponse where
  toSamples _ = noSamples

instance Arbitrary PostCompileResponse where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema PostCompileResponse where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Post Compile Response"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: PostCompileResponse
      ex =
        PostCompileResponse
          { postcompileresponseContractName = "MySampleContract",
            postcompileresponseCodeHash = hash "codeHash"
          }

type PostContractsXabi =
  "contracts"
    :> "xabi"
    -- Leave FormUrlEncoded just for backwords compatibility with current extabi users.
    :> ReqBody '[JSON, FormUrlEncoded] PostXabiRequest
    :> Post '[JSON] PostXabiResponse

data PostXabiRequest = PostXabiRequest
  { postxabirequestSrc :: Text
  }
  deriving (Eq, Show, Generic)

postXabiOptions :: FormOptions
postXabiOptions = FormOptions (const "src")

instance ToForm PostXabiRequest where
  toForm = genericToForm postXabiOptions

instance FromForm PostXabiRequest where
  fromForm = genericFromForm postXabiOptions

instance ToJSON PostXabiRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostXabiRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostXabiRequest where
  toSamples _ = noSamples

instance Arbitrary PostXabiRequest where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema PostXabiRequest where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Post Xabi Request"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: PostXabiRequest
      ex = PostXabiRequest "contract x { }"

data PostXabiResponse = PostXabiResponse
  { postxabiresponseSrc :: Map Text Xabi
  }
  deriving (Eq, Show, Generic)

instance ToJSON PostXabiResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostXabiResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostXabiResponse where
  toSamples _ = noSamples

instance Arbitrary PostXabiResponse where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema PostXabiResponse where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Post Xabi Response"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: PostXabiResponse
      ex = PostXabiResponse Map.empty

--------------------------------------------------------------------------------

newtype SymbolName = SymbolName Text deriving (Eq, Show, Generic)

instance ToParamSchema SymbolName

instance ToSchema SymbolName where
  declareNamedSchema _ =
    declareNamedSchema (Proxy :: Proxy Text)
      & mapped . schema . example ?~ toJSON (SymbolName "SymbolName")

instance IsString SymbolName where
  fromString = SymbolName . Text.pack

instance ToSample SymbolName where
  toSamples _ =
    samples
      [SymbolName _name | _name <- ["variable1", "variable2"]]

instance FromJSON SymbolName where parseJSON = fmap SymbolName . parseJSON

instance ToJSON SymbolName where toJSON (SymbolName _name) = toJSON _name

instance Arbitrary SymbolName where arbitrary = GR.genericArbitrary GR.uniform

instance ToHttpApiData SymbolName where
  toUrlPiece (SymbolName _name) = _name

instance FromHttpApiData SymbolName where
  parseUrlPiece = Right . SymbolName
