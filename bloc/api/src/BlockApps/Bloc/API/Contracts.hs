{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    DataKinds
  , FlexibleInstances
  , DeriveGeneric
  , OverloadedStrings
  , TypeOperators
  , TypeSynonymInstances
#-}

module BlockApps.Bloc.API.Contracts where

import Data.Aeson
import Data.Aeson.Casing
import Data.Aeson.Encoding
import Data.Int (Int64)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.String (IsString(..))
import Data.Text (Text)
import qualified Data.Text as Text
import Generic.Random.Generic
import GHC.Generics
import Servant.API
import Servant.Docs
import Test.QuickCheck
import Test.QuickCheck.Instances ()

import BlockApps.Bloc.API.Utils
import BlockApps.Ethereum
import BlockApps.Solidity.SolidityValue
import BlockApps.Solidity.Xabi

--------------------------------------------------------------------------------
-- | MonadContracts
--------------------------------------------------------------------------------

class Monad m => MonadContracts m where
  getContracts :: m GetContractsResponse
  getContractsData :: ContractName -> m [MaybeNamed Address]
  getContractsContract :: ContractName -> MaybeNamed Address -> m ContractDetails
  getContractsState :: ContractName -> MaybeNamed Address -> m GetContractsStateResponses -- state-translation
  getContractsFunctions :: ContractName -> MaybeNamed Address -> m [FunctionName]
  getContractsSymbols :: ContractName -> MaybeNamed Address -> m [SymbolName]
  getContractsStateMapping :: ContractName -> MaybeNamed Address -> SymbolName -> Text -> m GetContractsStateMappingResponse -- state-translation
  getContractsStates :: ContractName -> m [GetContractsStatesResponse] -- state-translation
  postContractsCompile :: [PostCompileRequest] -> m [PostCompileResponse]

--------------------------------------------------------------------------------
-- | Routes and types
--------------------------------------------------------------------------------
type GetContracts = "contracts" :> Get '[JSON] GetContractsResponse
data AddressCreatedAt = AddressCreatedAt
  { createdAt :: Int64
  , address :: MaybeNamed Address
  } deriving (Eq, Show, Generic)
instance ToJSON AddressCreatedAt
instance FromJSON AddressCreatedAt
instance Arbitrary AddressCreatedAt where arbitrary = genericArbitrary uniform
newtype GetContractsResponse = GetContractsResponse
  { unContracts :: Map Text [AddressCreatedAt] }
  deriving (Eq, Show, Generic)
instance ToJSON GetContractsResponse where
  toJSON = toJSON . unContracts
instance FromJSON GetContractsResponse where
  parseJSON = fmap GetContractsResponse . parseJSON
instance Arbitrary GetContractsResponse where arbitrary = genericArbitrary uniform
instance ToSample GetContractsResponse where
  toSamples _ = singleSample $ GetContractsResponse $ Map.singleton "Sample"
    [ AddressCreatedAt
      { address = Unnamed $ Address 0x309e10eddc6333b82889bfc25a2b107b9c2c9a8c
      , createdAt = 100
      }
    , AddressCreatedAt
      { address = Named "Addressed"
      , createdAt = 101
      }
    ]

type GetContractsData = "contracts"
  :> Capture "contractName" ContractName
  :> Get '[OctetStream] [MaybeNamed Address]

-- GET /contracts/:contractName/:contractAddress.:extension? TODO: Check .extension
type GetContractsContract = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" (MaybeNamed Address)
  :> Get '[HTMLifiedJSON] ContractDetails

type GetContractsState = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" (MaybeNamed Address)
  :> "state"
  :> Get '[JSON] GetContractsStateResponses -- change to HTML
type GetContractsStateResponses = Map Text SolidityValue -- Should be solidity values but we have problems with parsing, e.g. FromJSON with the current format
instance ToSample GetContractsStateResponses where toSamples _ = noSamples

-- GET /contracts/:contractName/:contractAddress/functions
type GetContractsFunctions = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" (MaybeNamed Address)
  :> "functions"
  :> Get '[HTMLifiedJSON] [FunctionName]
newtype FunctionName = FunctionName Text deriving (Eq,Show,Generic)
instance ToSample FunctionName where
  toSamples _ = samples
    [ FunctionName name | name <- ["functionCall1","functionCall2"]]
instance FromJSON FunctionName where
  parseJSON = fmap FunctionName . parseJSON
instance ToJSON FunctionName where
  toJSON (FunctionName name) = toJSON name
instance Arbitrary FunctionName where
  arbitrary = genericArbitrary uniform

-- GET /contracts/:contractName/:contractAddress/symbols
type GetContractsSymbols = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" (MaybeNamed Address)
  :> "symbols"
  :> Get '[HTMLifiedJSON] [SymbolName]

-- GET /contracts/:contractName/:contractAddress/state/:mapping/:key
type GetContractsStateMapping = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" (MaybeNamed Address)
  :> "state"
  :> Capture "mapping" SymbolName
  :> Capture "key" Text
  :> Get '[JSON] GetContractsStateMappingResponse
instance ToCapture (Capture "key" Text) where
  toCapture _ = DocCapture "key" "a mapping key"
instance ToCapture (Capture "mapping" SymbolName) where
  toCapture _ = DocCapture "mapping" "the mapping's name"
type GetContractsStateMappingResponse =
  Map Text (Map Text SolidityValue)
instance ToSample GetContractsStateMappingResponse where
  toSamples _ = noSamples

-- GET /contracts/:contractName/all/states/
type GetContractsStates = "contracts"
  :> Capture "contractName" ContractName
  :> "all"
  :> "states"
  :> Get '[JSON] [GetContractsStatesResponse]
type GetContractsStatesResponse = Map Address (Map Text SolidityValue)
instance FromJSONKey Address where
  fromJSONKey = FromJSONKeyTextParser
    $ maybe (fail "could not decode address") return
    . stringAddress . Text.unpack
instance ToJSONKey Address where
  toJSONKey = ToJSONKeyText f g
    where f x = Text.pack $ addressString x
          g x = text . Text.pack $ addressString x
instance ToSample GetContractsStatesResponse where
  toSamples _ = noSamples

-- POST /contracts/compile
type PostContractsCompile = "contracts"
  :> "compile"
  :> ReqBody '[JSON] [PostCompileRequest]
  :> Post '[JSON] [PostCompileResponse]
data PostCompileRequest = PostCompileRequest
  { postcompilerequestSearchable :: [Text]
  , postcompilerequestContractName :: Text
  , postcompilerequestSource :: Text
  } deriving (Eq,Show,Generic)
instance Arbitrary PostCompileRequest where arbitrary = genericArbitrary uniform
instance ToJSON PostCompileRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostCompileRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostCompileRequest where
  toSamples _ = noSamples

data PostCompileResponse = PostCompileResponse
  { postcompileresponseContractName :: Text
  , postcompileresponseCodeHash :: Keccak256
  } deriving (Eq,Show,Generic)
instance ToJSON PostCompileResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostCompileResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostCompileResponse where
  toSamples _ = noSamples
instance Arbitrary PostCompileResponse where
  arbitrary = genericArbitrary uniform

newtype SymbolName = SymbolName Text deriving (Eq,Show,Generic)
instance IsString SymbolName where
  fromString = SymbolName . Text.pack
instance ToSample SymbolName where
  toSamples _ = samples
    [ SymbolName name | name <- ["variable1","variable2"]]
instance FromJSON SymbolName where parseJSON = fmap SymbolName . parseJSON
instance ToJSON SymbolName where toJSON (SymbolName name) = toJSON name
instance Arbitrary SymbolName where arbitrary = genericArbitrary uniform
instance ToHttpApiData SymbolName where
  toUrlPiece (SymbolName name) = name
instance FromHttpApiData SymbolName where
  parseUrlPiece = Right . SymbolName

