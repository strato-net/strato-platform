{-# LANGUAGE
    DataKinds
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , TypeApplications
  , TypeOperators
#-}

module BlockApps.Bloc.API.Users where

import Data.Aeson
import Data.Aeson.Casing
import Data.HashMap.Strict (HashMap)
import Data.Proxy
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import Numeric.Natural
import Servant.API
import Servant.Client
import Servant.Docs
import Test.QuickCheck
import Web.FormUrlEncoded

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Data
import BlockApps.Strato.Types (PostTransaction)

class Monad m => MonadUsers m where
  getUsers :: m [UserName]
  getUsersUser :: UserName -> m [Address]
  postUsersUser :: UserName -> PostUsersUserRequest -> m Address
  postUsersSend :: UserName -> Address -> PostSendParameters -> m PostTransaction
  postUsersContract :: UserName -> Address -> PostUsersContractRequest -> m Keccak256
  postUsersUploadList :: UserName -> Address -> UploadListRequest -> m UnstructuredJSON
  postUsersContractMethod :: UserName -> Address -> ContractName -> Address -> m NoContent
  postUsersSendList :: UserName -> Address -> PostSendListRequest -> m [PostSendListResponse]
  postUsersContractMethodList :: UserName -> Address -> PostMethodListRequest -> m [PostMethodListResponse]
instance MonadUsers ClientM where
  getUsers = client (Proxy @ GetUsers)
  getUsersUser = client (Proxy @ GetUsersUser)
  postUsersUser = client (Proxy @ PostUsersUser)
  postUsersSend = client (Proxy @ PostUsersSend)
  postUsersContract = client (Proxy @ PostUsersContract)
  postUsersUploadList = client (Proxy @ PostUsersUploadList)
  postUsersContractMethod = client (Proxy @ PostUsersContractMethod)
  postUsersSendList = client (Proxy @ PostUsersSendList)
  postUsersContractMethodList = client (Proxy @ PostUsersContractMethodList)
instance MonadUsers Bloc where
  getUsers = undefined
  getUsersUser = undefined
  postUsersUser = undefined
  postUsersSend = undefined
  postUsersContract = undefined
  postUsersUploadList = undefined
  postUsersContractMethod = undefined
  postUsersSendList = undefined
  postUsersContractMethodList = undefined

type GetUsers = "users" :> Get '[HTMLifiedJSON] [UserName]

type GetUsersUser = "users"
  :> Capture "user" UserName
  :> Get '[HTMLifiedJSON] [Address]

type PostUsersUser = "users"
  :> Capture "user" UserName
  :> ReqBody '[FormUrlEncoded] PostUsersUserRequest
  :> Post '[HTMLifiedAddress] Address
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

type PostUsersSend = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "send"
  :> ReqBody '[FormUrlEncoded] PostSendParameters
  :> Post '[HTMLifiedJSON] PostTransaction
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

type PostUsersContract = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "contract"
  :> ReqBody '[FormUrlEncoded] PostUsersContractRequest
  :> Post '[JSON] Keccak256
data PostUsersContractRequest = PostUsersContractRequest
  { src :: Text
  , password :: Text
  } deriving (Eq,Show,Generic)
instance ToForm PostUsersContractRequest
instance FromForm PostUsersContractRequest
instance ToSample PostUsersContractRequest where
  toSamples _ = singleSample PostUsersContractRequest
    { src =
      "contract SimpleStorage { uint storedData; function set(uint x) \
      \{ storedData = x; } function get() returns (uint retVal) \
      \{ return storedData; } }"
    , password = "securePassword"
    }

type PostUsersUploadList = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "uploadList"
  :> ReqBody '[JSON] UploadListRequest
  :> Post '[JSON] UnstructuredJSON
data UploadListRequest = UploadListRequest
  { uploadlistPassword :: Text
  , uploadlistContracts :: [UploadListContract]
  , uploadlistResolve :: Bool
  } deriving (Eq,Show,Generic)
instance ToJSON UploadListRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON UploadListRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample UploadListRequest where
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

--POST /users/:user/:address/callList
type PostUsersContractMethodList = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "callList"
  :> ReqBody '[JSON] PostMethodListRequest
  :> Post '[JSON] [PostMethodListResponse]
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

data TxParams = TxParams
  { txparamsGasLimit :: Natural
  , txparamsGasPrice :: Natural
  } deriving (Eq,Show,Generic)
instance ToJSON TxParams where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON TxParams where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
