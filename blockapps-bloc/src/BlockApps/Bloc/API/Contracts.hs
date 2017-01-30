{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    DataKinds
  , DeriveAnyClass
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , TypeApplications
  , TypeOperators
#-}

module BlockApps.Bloc.API.Contracts where

import Control.Monad.Except
import Control.Monad.Reader
import Data.Aeson
import Data.Aeson.Casing
import qualified Data.Aeson.Types as JSON (fieldLabelModifier)
import Data.Maybe
import Data.Proxy
import Data.Text (Text)
import Data.Time
import Generic.Random.Generic
import GHC.Generics
import qualified Hasql.Decoders as Decoders
import qualified Hasql.Encoders as Encoders
import Hasql.Query
import Hasql.Session
import Servant.API
import Servant.Client
import Servant.Docs
import Test.QuickCheck
import Test.QuickCheck.Instances ()

import BlockApps.Bloc.API.Addresses
import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Data

class Monad m => MonadContracts m where
  getContracts :: m Contracts
  getContractsData :: ContractName -> m [Address]
  getContractsContract :: ContractName -> Address -> m UnstructuredJSON
  getContractsState :: ContractName -> Address -> m UnstructuredJSON
  getContractsFunctions :: ContractName -> Address -> m [FunctionName]
  getContractsSymbols :: ContractName -> Address -> m [SymbolName]
  getContractsStateMapping :: ContractName -> Address -> SymbolName -> Text -> m GetContractsStateMappingResponse
  getContractsStates :: ContractName -> m UnstructuredJSON
  postContractsCompile :: [PostCompileRequest] -> m [PostCompileResponse]
instance MonadContracts ClientM where
  getContracts = client (Proxy @ GetContracts)
  getContractsData = client (Proxy @ GetContractsData)
  getContractsContract = client (Proxy @ GetContractsContract)
  getContractsState = client (Proxy @ GetContractsState)
  getContractsFunctions = client (Proxy @ GetContractsFunctions)
  getContractsSymbols = client (Proxy @ GetContractsSymbols)
  getContractsStateMapping = client (Proxy @ GetContractsStateMapping)
  getContractsStates = client (Proxy @ GetContractsStates)
  postContractsCompile = client (Proxy @ PostContractsCompile)
instance MonadContracts Bloc where
  getContracts = do
    conn <- asks dbConnection
    let
      contractsQuery = statement
        "SELECT address, timestamp FROM contracts_instance;"
        Encoders.unit
        (Decoders.rowsList contractDecoder)
        False
    contractsEither <- liftIO $ run (query () contractsQuery) conn
    case contractsEither of
      Left err -> throwError $ DBError err
      Right cntrcts -> return . Contracts $ catMaybes cntrcts
  getContractsData (ContractName contractName) = do
    conn <- asks dbConnection
    let
      contractsDataQuery = statement
        "SELECT CI.address\
        \ FROM\
        \ Contracts C JOIN contracts_metadata CM\
        \ ON CM.contract_id = C.id\
        \ JOIN contracts_instance CI\
        \ ON CI.contract_metadata_id = CM.id\
        \ WHERE C.name = $1;"
        (Encoders.value Encoders.text)
        (Decoders.rowsList (Decoders.value addressDecoder))
        False
    addressesEither <- liftIO $
      run (query contractName contractsDataQuery) conn
    case addressesEither of
      Left err -> throwError $ DBError err
      Right addresses -> return $ catMaybes addresses
  getContractsContract = undefined
  getContractsState = undefined
  getContractsFunctions = undefined
  getContractsStateMapping = undefined
  getContractsStates = undefined
  postContractsCompile = undefined
  getContractsSymbols = undefined

type GetContracts = "contracts" :> Get '[JSON] Contracts
data Contract = Contract
  { createdAt :: LocalTime
  , address :: Address
  } deriving (Eq, Show, Generic)
instance ToJSON Contract
instance FromJSON Contract
instance Arbitrary Contract where arbitrary = genericArbitrary
newtype Contracts = Contracts
  { contracts :: [Contract] } deriving (Eq, Show, Generic)
instance ToJSON Contracts where
  toJSON = genericToJSON defaultOptions
    {JSON.fieldLabelModifier = const "Address"}
instance FromJSON Contracts where
  parseJSON = genericParseJSON defaultOptions
    {JSON.fieldLabelModifier = const "Address"}
instance Arbitrary Contracts where arbitrary = genericArbitrary
instance ToSample Contracts where
  toSamples _ = singleSample $ Contracts
    [ Contract
      { address = Address 0x309e10eddc6333b82889bfc25a2b107b9c2c9a8c
      , createdAt = LocalTime (ModifiedJulianDay 100) midnight
      }
    , Contract
      { address = Address 0xdeadbeef
      , createdAt = LocalTime (ModifiedJulianDay 101) midday
      }
    ]

type GetContractsData = "contracts"
  :> Capture "contractName" ContractName
  :> Get '[OctetStream] [Address]

-- GET /contracts/:contractName/:contractAddress.:extension? TODO: Check .extension
type GetContractsContract = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> Get '[JSON] UnstructuredJSON

type GetContractsState = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> "state"
  :> Get '[JSON] UnstructuredJSON -- change to HTML

-- GET /contracts/:contractName/:contractAddress/functions
type GetContractsFunctions = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> "functions"
  :> Get '[HTMLifiedJSON] [FunctionName]
newtype FunctionName = FunctionName Text deriving(Eq,Show,Generic)
instance ToSample FunctionName where
  toSamples _ = samples
    [ FunctionName name | name <- ["functionCall1","functionCall2"]]
instance FromJSON FunctionName where
  parseJSON = fmap FunctionName . parseJSON
instance ToJSON FunctionName where
  toJSON (FunctionName name) = toJSON name
instance Arbitrary FunctionName where
  arbitrary = genericArbitrary

-- GET /contracts/:contractName/:contractAddress/symbols
type GetContractsSymbols = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> "symbols"
  :> Get '[JSON] [SymbolName]

-- GET /contracts/:contractName/:contractAddress/state/:mapping/:key
type GetContractsStateMapping = "contracts"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> "state"
  :> Capture "mapping" SymbolName
  :> Capture "key" Text
  :> Get '[JSON] GetContractsStateMappingResponse
newtype GetContractsStateMappingResponse = GetContractsStateMappingResponse
  { getContractStateMappingResponseValue :: Value
  } deriving (Eq,Show,Generic)
instance ToJSON GetContractsStateMappingResponse where
  toJSON (GetContractsStateMappingResponse resp) = toJSON resp
instance FromJSON GetContractsStateMappingResponse where
  parseJSON = fmap GetContractsStateMappingResponse . parseJSON
instance Arbitrary GetContractsStateMappingResponse where
  arbitrary = return $ GetContractsStateMappingResponse Null
instance ToSample GetContractsStateMappingResponse where
  toSamples _ = noSamples
instance ToCapture (Capture "key" Text) where
  toCapture _ = DocCapture "key" "a mapping key"
instance ToCapture (Capture "mapping" SymbolName) where
  toCapture _ = DocCapture "mapping" "the mapping's name"

-- GET /contracts/:contractName/all/states/
type GetContractsStates = "contracts"
  :> Capture "contractName" ContractName
  :> "all"
  :> "states"
  :> Get '[JSON] UnstructuredJSON

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
instance ToJSON PostCompileRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostCompileRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostCompileRequest where
  toSamples _ = noSamples
data PostCompileResponse = PostCompileResponse
  { postcompileresponseContractName :: String
  , postcompileresponseCodeHash :: String
  } deriving (Eq,Show,Generic)
instance ToJSON PostCompileResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostCompileResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostCompileResponse where
  toSamples _ = noSamples
instance Arbitrary PostCompileResponse where
  arbitrary = genericArbitrary

newtype SymbolName = SymbolName Text deriving (Eq,Show,Generic)
instance ToSample SymbolName where
  toSamples _ = samples
    [ SymbolName name | name <- ["variable1","variable2"]]
instance FromJSON SymbolName where parseJSON = fmap SymbolName . parseJSON
instance ToJSON SymbolName where toJSON (SymbolName name) = toJSON name
instance Arbitrary SymbolName where arbitrary = genericArbitrary
instance ToHttpApiData SymbolName where
  toUrlPiece (SymbolName name) = name
instance FromHttpApiData SymbolName where
  parseUrlPiece = Right . SymbolName

contractDecoder :: Decoders.Row (Maybe Contract)
contractDecoder = contractMaybe
  <$> Decoders.value Decoders.timestamp
  <*> Decoders.value addressDecoder
  where
    contractMaybe _time Nothing = Nothing
    contractMaybe time (Just addr) = Just $ Contract time addr
