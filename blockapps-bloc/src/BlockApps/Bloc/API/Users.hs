{-# LANGUAGE
    DataKinds
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , TypeApplications
  , TypeOperators
  , GeneralizedNewtypeDeriving
#-}

module BlockApps.Bloc.API.Users where

import Control.Monad.Except
import Control.Monad.Reader
import Data.Aeson
import Data.Aeson.Casing
import qualified Data.ByteString.Lazy as ByteString.Lazy
import Data.HashMap.Strict (HashMap)
import Data.Proxy
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Generic.Random.Generic
import GHC.Generics
import Hasql.Session
import Numeric.Natural
import Servant.API
import Servant.Client
import Servant.Docs
import Test.QuickCheck
import Web.FormUrlEncoded

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Crypto
import BlockApps.Bloc.Monad
import BlockApps.Bloc.Queries
import BlockApps.Ethereum
import BlockApps.Strato.Types (PostTransaction)
import BlockApps.Strato.API.Client

-- Following imported for HTMLifiedPlainText. TODO: Remove when refactoring.
import qualified Data.ByteString.Lazy.Char8 as Lazy.Char8
import qualified Network.HTTP.Media as M

class Monad m => MonadUsers m where
  getUsers :: m [UserName]
  getUsersUser :: UserName -> m [Address]
  postUsersUser :: UserName -> PostUsersUserRequest -> m Address
  postUsersSend :: UserName -> Address -> PostSendParameters -> m PostTransaction
  postUsersContract :: UserName -> Address -> PostUsersContractRequest -> m Address
  postUsersUploadList :: UserName -> Address -> UploadListRequest -> m [PostUsersUploadListResponse]
  postUsersContractMethod :: UserName -> Address -> ContractName -> Address -> PostUsersContractMethodRequest -> m PostUsersContractMethodResponse
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

  getUsers = runHasql $ map UserName <$> query () getUsersQuery

  getUsersUser (UserName name) = runHasql $ query name getUsersUserQuery

  postUsersUser (UserName name) (PostUsersUserRequest faucet pass) = do
    keyStore <- liftIO . newKeyStore . Password $ Text.encodeUtf8 pass
    mngr <- asks httpManager
    url <- asks urlStrato
    runHasql $ query (name,keyStore) postUsersUserQuery
    let
      addr = keystoreAcctAddress keyStore
    liftIO . when (faucet == 1) $
      void $ runClientM (postFaucet addr) (ClientEnv mngr url)
    return addr

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
instance Arbitrary PostUsersUserRequest where arbitrary = genericArbitrary
instance ToJSON PostUsersUserRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostUsersUserRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
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
instance Arbitrary PostSendParameters where arbitrary = genericArbitrary
instance ToJSON PostSendParameters where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostSendParameters where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
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
  :> Post '[HTMLifiedAddress] Address
data PostUsersContractRequest = PostUsersContractRequest
  { src :: Text
  , password :: Text
  } deriving (Eq,Show,Generic)
instance Arbitrary PostUsersContractRequest where arbitrary = genericArbitrary
instance ToJSON PostUsersContractRequest
instance FromJSON PostUsersContractRequest
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
  :> Post '[JSON] [PostUsersUploadListResponse]
data UploadListRequest = UploadListRequest
  { uploadlistPassword :: Text
  , uploadlistContracts :: [UploadListContract]
  , uploadlistResolve :: Bool
  } deriving (Eq,Show,Generic)
instance ToJSON UploadListRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON UploadListRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary UploadListRequest where arbitrary = genericArbitrary
instance ToSample UploadListRequest where
  toSamples _ = noSamples
data UploadListContract = UploadListContract
  { uploadlistcontractContractName :: Text
  , uploadlistcontractArgs :: HashMap Text Text
  , uploadlistcontractTxParams :: TxParams
  } deriving (Eq,Show,Generic)
instance Arbitrary UploadListContract where arbitrary = genericArbitrary
instance ToJSON UploadListContract where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON UploadListContract where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
newtype PostUsersUploadListResponse = PostUsersUploadListResponse
  { contractJSON :: ContractDetails } deriving (Eq,Show,Generic)
instance Arbitrary PostUsersUploadListResponse where
  arbitrary = genericArbitrary
instance ToJSON PostUsersUploadListResponse where
  toJSON (PostUsersUploadListResponse contractDetails) = object
    [ "contractJSON" .= Text.decodeUtf8 (ByteString.Lazy.toStrict (encode contractDetails)) ]
instance FromJSON PostUsersUploadListResponse where
  parseJSON = withObject "PostUsersUploadListResponse" $ \obj -> do
    str <- obj .: "contractJSON"
    case eitherDecode (ByteString.Lazy.fromStrict (Text.encodeUtf8 str)) of
      Left err -> fail err
      Right details -> return $ PostUsersUploadListResponse details
instance ToSample PostUsersUploadListResponse where
  toSamples _ = noSamples

-- This should return the return value from the method call
type PostUsersContractMethod = "users"
  :> Capture "user" UserName
  :> Capture "userAddress" Address
  :> "contract"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> "call"
  :> ReqBody '[JSON] PostUsersContractMethodRequest
  :> Post '[HTMLifiedPlainText] PostUsersContractMethodResponse
data PostUsersContractMethodRequest = PostUsersContractMethodRequest
  { postuserscontractmethodPassword :: Text
  , postuserscontractmethodMethod :: Text
  , postuserscontractmethodArgs :: HashMap Text SolidityValue
  , postuserscontractmethodValue :: Natural
  } deriving (Eq,Show,Generic)

instance Arbitrary PostUsersContractMethodRequest where arbitrary = genericArbitrary
instance ToJSON PostUsersContractMethodRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostUsersContractMethodRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostUsersContractMethodRequest where
  toSamples _ = noSamples
newtype PostUsersContractMethodResponse = PostUsersContractMethodResponse Text deriving (Eq,Show,FromJSON,ToJSON,Arbitrary)
instance ToSample PostUsersContractMethodResponse where
  toSamples _ = noSamples
--hack because endpoints are returning random text
data HTMLifiedPlainText
instance Accept HTMLifiedPlainText where
  contentType _ = "text" M.// "html" M./: ("charset", "utf-8")
instance MimeUnrender HTMLifiedPlainText PostUsersContractMethodResponse where
  mimeUnrender _ = return . PostUsersContractMethodResponse . Text.pack . Lazy.Char8.unpack
instance MimeRender HTMLifiedPlainText PostUsersContractMethodResponse where
  mimeRender _ (PostUsersContractMethodResponse resp) =  Lazy.Char8.pack $ Text.unpack resp

-- POST /users/:user/:userAddress/sendList
type PostUsersSendList = "users"
  :> Capture "user" UserName
  :> Capture "userAddress" Address
  :> "sendList"
  :> ReqBody '[JSON] PostSendListRequest
  :> Post '[JSON] [PostSendListResponse]
data PostSendListRequest = PostSendListRequest
  { postsendlistrequestPassword :: Text
  , postsendlistrequestResolve :: Bool
  , postsendlistrequestTxs :: [SendTransaction]
  } deriving (Eq,Show,Generic)
instance Arbitrary PostSendListRequest where arbitrary = genericArbitrary
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
instance Arbitrary SendTransaction where arbitrary = genericArbitrary
instance ToJSON SendTransaction where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON SendTransaction where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
newtype PostSendListResponse = PostSendListResponse
  { postsendlistresponseSenderBalance :: Text
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
  { postmethodlistrequestPassword :: Text
  , postmethodlistrequestResolve :: Bool
  , postmethodlistrequestTxs :: [MethodCall]
  } deriving (Eq,Show,Generic)
instance Arbitrary PostMethodListRequest where arbitrary = genericArbitrary
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
  { methodcallContractName :: Text
  , methodcallContractAddress :: Address
  , methodcallMethodName :: Text
  , methodcallArgs :: HashMap Text SolidityValue
  , methodcallValue :: Natural
  , methodcallTxParams :: TxParams --TODO: Params maybe optional
  } deriving (Eq,Show,Generic)
instance Arbitrary MethodCall where arbitrary = genericArbitrary
instance ToJSON MethodCall where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON MethodCall where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
