{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    DataKinds
  , DeriveAnyClass
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , TypeOperators
#-}

module BlockApps.Bloc.API where

import Data.Aeson
import Data.Aeson.Casing
import qualified Data.Aeson.Types as JSON (fieldLabelModifier)
import qualified Data.ByteString.Lazy.Char8 as LBS
import Data.HashMap.Strict (HashMap)
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import qualified Network.HTTP.Media as M
import Numeric.Natural
import Servant.API
import Servant.Docs
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Web.FormUrlEncoded

import BlockApps.Data
import BlockApps.Strato.Types (PostTransaction)

type BlocAPI =
  -- /users endpoints
       GetUsers
  :<|> PostUsersUser
  :<|> GetUsersUser
  :<|> PostUsersSend
  :<|> PostUsersContract
  :<|> PostUsersUploadList
  :<|> PostUsersContractMethod
  :<|> PostUsersSendList
  :<|> PostUsersContractMethodList
  -- /address endpoints
  :<|> GetAddresses
  :<|> GetAddressesPending
  :<|> GetAddressesPendingRemove
  -- /contracts endpoints
  :<|> GetContracts
  :<|> GetContractsData
  :<|> GetContractsContract
  :<|> GetContractsState
  :<|> GetContractsFunctions
  :<|> GetContractsSymbols
  :<|> GetContractsStateMapping
  :<|> GetContractsStates
  :<|> PostContractsCompile
  -- /search endpoints
  :<|> GetSearchContract
  :<|> GetSearchContractState
  :<|> GetSearchContractStateReduced

-- /user endpoint types

type GetUsers = "users" :> Get '[HTMLifiedJSON] [UserName]

type GetUsersUser = "users"
  :> Capture "user" UserName
  :> Get '[HTMLifiedJSON] [Address]

type PostUsersUser = "users"
  :> Capture "user" UserName
  :> ReqBody '[FormUrlEncoded] PostUsersUserRequest
  :> Post '[HTMLifiedAddress] Address

type PostUsersSend = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "send"
  :> ReqBody '[FormUrlEncoded] PostSendParameters
  :> Post '[HTMLifiedJSON] PostTransaction

type PostUsersContract = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "contract"
  :> ReqBody '[FormUrlEncoded] SrcPassword
  :> Post '[JSON] Keccak256

type PostUsersUploadList = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "uploadList"
  :> ReqBody '[JSON] UploadList
  :> Post '[JSON] UnstructuredJSON

-- This should return the return value from the method call
type PostUsersContractMethod = "users"
  :> Capture "user" UserName
  :> Capture "userAddress" Address
  :> "contract"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> "call"
  :> Post '[JSON] NoContent

-- POST /users/:user/:userAddress/sendList
type PostUsersSendList = "users"
  :> Capture "user" UserName
  :> Capture "userAddress" Address
  :> "sendList"
  :> ReqBody '[JSON] PostSendListRequest
  :> Post '[JSON] [PostSendListResponse]

--POST /users/:user/:address/callList
type PostUsersContractMethodList = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "callList"
  :> ReqBody '[JSON] PostMethodListRequest
  :> Post '[JSON] [PostMethodListResponse]

type GetAddresses = "addresses" :> Get '[HTMLifiedJSON] [Address]

-- GET /addresses/:address/pending
type GetAddressesPending = "addresses"
  :> Capture "address" Address
  :> "pending"
  :> Get '[JSON] NoContent

-- GET /addresses/:address/pending/remove/:time
type GetAddressesPendingRemove = "addresses"
  :> Capture "address" Address
  :> "pending"
  :> "remove"
  :> Capture "time" Int
  :> Get '[JSON] NoContent

type GetContracts = "contracts" :> Get '[JSON] Contracts

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

-- GET /search/:contractName
type GetSearchContract = "search"
  :> Capture "contractName" ContractName
  :> Get '[OctetStream] UnstructuredJSON

-- GET /search/:contractName/state
type GetSearchContractState = "search"
  :> Capture "contractName" ContractName
  :> "state"
  :> Get '[JSON] [SearchContractState]

-- GET /search/:contractName/state/reduced
type GetSearchContractStateReduced = "search"
  :> Capture "contractName" ContractName
  :> "state"
  :> "reduced"
  :> QueryParams "props" Text
  :> Get '[JSON] [SearchContractState]

instance ToParam (QueryParams "props" Text) where
  toParam _ = DocQueryParam "props" ["id","value"] "Names of contract variables" List

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

instance ToCapture (Capture "time" Int) where
  toCapture _ = DocCapture "time" "a unix timestamp"

newtype UserName = UserName Text deriving (Eq,Show,Generic)
instance ToHttpApiData UserName where
  toUrlPiece (UserName name) = name
instance FromHttpApiData UserName where
  parseUrlPiece = Right . UserName
instance ToJSON UserName where
  toJSON (UserName name) = toJSON name
instance FromJSON UserName where
  parseJSON = fmap UserName . parseJSON
instance ToSample UserName where
  toSamples _ = samples
    [ UserName name | name <- ["samrit", "eitan", "ilya", "ilir"]]
instance ToCapture (Capture "user" UserName) where
  toCapture _ = DocCapture "user" "a user name"
instance Arbitrary UserName where arbitrary = genericArbitrary

newtype ContractName = ContractName Text
instance ToHttpApiData ContractName where
  toUrlPiece (ContractName name) = name
instance FromHttpApiData ContractName where
  parseUrlPiece = Right . ContractName
instance ToJSON ContractName where
  toJSON (ContractName name) = toJSON name
instance FromJSON ContractName where
  parseJSON = fmap ContractName . parseJSON
instance ToCapture (Capture "contractName" ContractName) where
  toCapture _ = DocCapture "contractName" "a contract name"

-- hack because endpoints are returning stringified json as text/html
data HTMLifiedJSON
instance Accept HTMLifiedJSON where
  contentType _ = "text" M.// "html" M./: ("charset", "utf-8")
instance FromJSON x => MimeUnrender HTMLifiedJSON x where
  mimeUnrender _ = eitherDecode
instance ToJSON x => MimeRender HTMLifiedJSON x where
  mimeRender _ = encode

data HTMLifiedAddress
instance Accept HTMLifiedAddress where
  contentType _ = "text" M.// "html" M./: ("charset", "utf-8")
instance MimeUnrender HTMLifiedAddress Address where
  mimeUnrender _
    = maybe (Left "could not unrender Address") Right
    . stringAddress . LBS.unpack
instance MimeRender HTMLifiedAddress Address where
  mimeRender _ = LBS.pack . addressString

-- hack because endpoints are returning stringified json
-- as application/octet-stream
instance FromJSON x => MimeUnrender OctetStream x where
  mimeUnrender _ = eitherDecode
instance ToJSON x => MimeRender OctetStream x where
  mimeRender _ = encode

data PostUsersUserRequest = PostUsersUserRequest
  { userFaucet :: Int
  , userPassword :: Text
  } deriving (Eq, Show, Generic)
instance ToForm PostUsersUserRequest where
  toForm = genericToForm (FormOptions (camelCase . drop 4))
instance FromForm PostUsersUserRequest where
  fromForm = genericFromForm (FormOptions (camelCase . drop 4))
instance ToSample PostUsersUserRequest where
  toSamples _ = singleSample PostUsersUserRequest
    { userFaucet = 1
    , userPassword = "securePassword"
    }

data SearchContractState = SearchContractState
  { searchcontractstateAddress :: Address
  , searchcontractstateState :: HashMap Text UnstructuredJSON
  } deriving (Eq, Show, Generic)
instance ToJSON SearchContractState where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON SearchContractState where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample SearchContractState where
  toSamples _ = noSamples
instance Arbitrary SearchContractState where
  arbitrary = genericArbitrary

data PostSendParameters = PostSendParameters
  { sendToAddress :: Address
  , sendValue :: Natural
  , sendPassword :: Text
  } deriving (Eq, Show, Generic)
instance ToForm PostSendParameters where
  toForm = genericToForm (FormOptions (camelCase . drop 4))
instance FromForm PostSendParameters where
  fromForm = genericFromForm (FormOptions (camelCase . drop 4))
instance ToSample PostSendParameters where
  toSamples _ = singleSample PostSendParameters
    { sendToAddress = Address 0xdeadbeef
    , sendValue = 10
    , sendPassword = "securePassword"
    }

newtype PostSendListResponse = PostSendListResponse
  { postsendlistresponseSenderBalance :: String
  } deriving (Eq,Show,Generic)
instance ToJSON PostSendListResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostSendListResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostSendListResponse where
  toSamples _ = noSamples
instance Arbitrary PostSendListResponse where
  arbitrary = genericArbitrary

data PostSendListRequest = PostSendListRequest
  { postsendlistrequestPassword :: String
  , postsendlistrequestResolve :: Bool
  , postsendlistrequestTxs :: [SendTransaction]
  } deriving (Eq,Show,Generic)
instance ToJSON PostSendListRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostSendListRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostSendListRequest where
  toSamples _ = noSamples

data SendTransaction = SendTransaction
  { sendtransactionToAddress :: Address
  , sendtransactionValue :: Natural
  , sendtransactionTxParams :: Maybe TxParams
  } deriving (Eq,Show,Generic)
instance ToJSON SendTransaction where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON SendTransaction where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

data PostMethodListRequest = PostMethodListRequest
  { postmethodlistrequestPassword :: String
  , postmethodlistrequestResolve :: Bool
  , postmethodlistrequestTxs :: [MethodCall]
  } deriving (Eq,Show,Generic)
instance ToJSON PostMethodListRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostMethodListRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostMethodListRequest where
  toSamples _ = noSamples

newtype PostMethodListResponse = PostMethodListResponse
  { postmethodlistresponseReturnValue :: Text
  } deriving (Eq,Show,Generic)
instance ToJSON PostMethodListResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostMethodListResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostMethodListResponse where
  toSamples _ = noSamples
instance Arbitrary PostMethodListResponse where arbitrary = genericArbitrary

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

data MethodCall = MethodCall
  { methodcallContractName :: String
  , methodcallContractAddress :: Address
  , methodcallMethodName :: String
  , methodcallArgs :: HashMap Text Value
  , methodcallValue :: Natural
  , methodcallTxParams :: TxParams
  } deriving (Eq,Show,Generic)
instance ToJSON MethodCall where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON MethodCall where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

data Contract = Contract
  { createdAt :: Integer
  , address :: Text
  } deriving (Eq, Show, Generic)
instance ToJSON Contract
instance FromJSON Contract
instance Arbitrary Contract where arbitrary = genericArbitrary

newtype Contracts = Contracts
  { addresses :: [Contract] } deriving (Eq, Show, Generic)
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
      { address = "309e10eddc6333b82889bfc25a2b107b9c2c9a8c"
      , createdAt = 1484957995000
      }
    , Contract
      { address = "Addressed"
      , createdAt = 1485193000000
      }
    ]

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

data SrcPassword = SrcPassword
  { src :: Text
  , password :: Text
  } deriving (Eq,Show,Generic)
instance ToForm SrcPassword
instance FromForm SrcPassword
instance ToSample SrcPassword where
  toSamples _ = singleSample SrcPassword
    { src =
      "contract SimpleStorage { uint storedData; function set(uint x) \
      \{ storedData = x; } function get() returns (uint retVal) \
      \{ return storedData; } }"
    , password = "securePassword"
    }

data UploadList = UploadList
  { uploadlistPassword :: Text
  , uploadlistContracts :: [UploadListContract]
  , uploadlistResolve :: Bool
  } deriving (Eq,Show,Generic)
instance ToJSON UploadList where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON UploadList where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample UploadList where
  toSamples _ = noSamples

data UploadListContract = UploadListContract
  { uploadlistcontractContractName :: Text
  , uploadlistcontractArgs :: HashMap Text Text
  , uploadlistcontractTxParams :: TxParams
  } deriving (Eq,Show,Generic)
instance ToJSON UploadListContract where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON UploadListContract where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

data TxParams = TxParams
  { txparamsGasLimit :: Natural
  , txparamsGasPrice :: Natural
  } deriving (Eq,Show,Generic)
instance ToJSON TxParams where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON TxParams where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

newtype UnstructuredJSON = UnstructuredJSON
  { getUnstructuredJSON :: Value
  } deriving (Eq,Show,Generic)
instance ToJSON UnstructuredJSON where
  toJSON (UnstructuredJSON resp) = toJSON resp
instance FromJSON UnstructuredJSON where
  parseJSON = fmap UnstructuredJSON . parseJSON
instance Arbitrary UnstructuredJSON where
  arbitrary = return $ UnstructuredJSON Null
instance ToSample UnstructuredJSON where
  toSamples _ = noSamples
