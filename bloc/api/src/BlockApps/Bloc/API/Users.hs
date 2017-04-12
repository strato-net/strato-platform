{-# LANGUAGE
    DataKinds
  , DeriveGeneric
  , GeneralizedNewtypeDeriving
  , OverloadedStrings
  , MultiParamTypeClasses
  , TypeOperators
#-}

module BlockApps.Bloc.API.Users where

import Data.Aeson
import Data.Aeson.Casing
import qualified Data.ByteString.Lazy.Char8 as Lazy.Char8
import qualified Data.ByteString.Lazy as ByteString.Lazy
import Data.Map (Map)
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Generic.Random.Generic
import GHC.Generics
import Numeric.Natural
import Servant.API
import Servant.Docs
import qualified Network.HTTP.Media as M
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Web.FormUrlEncoded


import BlockApps.Bloc.Crypto
import BlockApps.Bloc.API.Utils
import BlockApps.Ethereum
import BlockApps.Solidity.Xabi
import BlockApps.Strato.Types

--------------------------------------------------------------------------------
-- | Routes and types
--------------------------------------------------------------------------------

type GetUsers = "users" :> Get '[HTMLifiedJSON] [UserName]

type GetUsersUser = "users"
  :> Capture "user" UserName
  :> Get '[HTMLifiedJSON] [Address]

type PostUsersUser = "users"
  :> Capture "user" UserName
  :> ReqBody '[FormUrlEncoded, JSON] PostUsersUserRequest
  :> Post '[HTMLifiedAddress] Address
data PostUsersUserRequest = PostUsersUserRequest
  { userFaucet :: Int
  , userPassword :: Password
  } deriving (Eq, Show, Generic)
instance Arbitrary PostUsersUserRequest where arbitrary = genericArbitrary uniform
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
  :> ReqBody '[JSON] PostSendParameters
  :> Post '[HTMLifiedJSON] PostTransaction
data PostSendParameters = PostSendParameters
  { sendToAddress :: Address
  , sendValue :: Natural
  , sendPassword :: Password
  , sendTxParams :: Maybe TxParams
  } deriving (Eq, Show, Generic)
instance Arbitrary PostSendParameters where arbitrary = genericArbitrary uniform
instance ToJSON PostSendParameters where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostSendParameters where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostSendParameters where
  toSamples _ = singleSample PostSendParameters
    { sendToAddress = Address 0xdeadbeef
    , sendValue = 10
    , sendPassword = "securePassword"
    , sendTxParams = Nothing
    }

type PostUsersContract = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "contract"
  :> ReqBody '[JSON] PostUsersContractRequest
  :> Post '[HTMLifiedAddress] Address
data PostUsersContractRequest = PostUsersContractRequest
  { postuserscontractrequestSrc :: Text
  , postuserscontractrequestPassword :: Password
  , postuserscontractrequestContract :: Text
  , postuserscontractrequestArgs :: Maybe (Map Text Text)
  , postuserscontractrequestTxParams :: Maybe TxParams
  , postuserscontractrequestValue :: Natural
  } deriving (Eq,Show,Generic)
instance Arbitrary PostUsersContractRequest where arbitrary = genericArbitrary uniform
-- TODO: This end point needs to support form url encoding
-- instance ToForm PostUsersContractRequest where
--     toForm PostUsersContractRequest{..} = Map.fromList
--       [ ("src", toQueryParam postuserscontractrequestSrc)
--       , ("password", toQueryParam postuserscontractrequestPassword)
--
--       ]
-- instance FromForm PostUsersContractRequest where
--
instance ToJSON PostUsersContractRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostUsersContractRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostUsersContractRequest where
  toSamples _ = singleSample PostUsersContractRequest
    { postuserscontractrequestSrc =
      "contract SimpleStorage { uint storedData; function set(uint x) \
      \{ storedData = x; } function get() returns (uint retVal) \
      \{ return storedData; } }"
    , postuserscontractrequestPassword = "securePassword"
    , postuserscontractrequestContract = "SimpleStorage"
    , postuserscontractrequestArgs = Nothing
    , postuserscontractrequestTxParams = Nothing
    , postuserscontractrequestValue = 1000000
    }

type PostUsersUploadList = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "uploadList"
  :> ReqBody '[JSON] UploadListRequest
  :> Post '[JSON] [PostUsersUploadListResponse]
data UploadListRequest = UploadListRequest
  { uploadlistPassword :: Password
  , uploadlistContracts :: [UploadListContract]
  , uploadlistResolve :: Bool
  } deriving (Eq,Show,Generic)
instance ToJSON UploadListRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON UploadListRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance Arbitrary UploadListRequest where arbitrary = genericArbitrary uniform
instance ToSample UploadListRequest where
  toSamples _ = noSamples
data UploadListContract = UploadListContract
  { uploadlistcontractContractName :: Text
  , uploadlistcontractArgs :: Map Text Text
  , uploadlistcontractTxParams :: Maybe TxParams
  , uploadlistcontractValue :: Maybe Natural
  } deriving (Eq,Show,Generic)
instance Arbitrary UploadListContract where arbitrary = genericArbitrary uniform
instance ToJSON UploadListContract where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON UploadListContract where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
newtype PostUsersUploadListResponse = PostUsersUploadListResponse
  { contractJSON :: ContractDetails } deriving (Eq,Show,Generic)
instance Arbitrary PostUsersUploadListResponse where
  arbitrary = genericArbitrary uniform
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
  { postuserscontractmethodPassword :: Password
  , postuserscontractmethodMethod :: Text
  , postuserscontractmethodArgs :: Map Text Text
  , postuserscontractmethodValue :: Natural
  , postuserscontractmethodTxParams :: Maybe TxParams
  } deriving (Eq,Show,Generic)

instance Arbitrary PostUsersContractMethodRequest where arbitrary = genericArbitrary uniform
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
  { postsendlistrequestPassword :: Password
  , postsendlistrequestResolve :: Bool
  , postsendlistrequestTxs :: [SendTransaction]
  } deriving (Eq,Show,Generic)
instance Arbitrary PostSendListRequest where arbitrary = genericArbitrary uniform
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
instance Arbitrary SendTransaction where arbitrary = genericArbitrary uniform
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
  arbitrary = genericArbitrary uniform

--POST /users/:user/:address/callList
type PostUsersContractMethodList = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "callList"
  :> ReqBody '[JSON] PostMethodListRequest
  :> Post '[JSON] [PostMethodListResponse]
data PostMethodListRequest = PostMethodListRequest
  { postmethodlistrequestPassword :: Password
  , postmethodlistrequestResolve :: Bool
  , postmethodlistrequestTxs :: [MethodCall]
  } deriving (Eq,Show,Generic)
instance Arbitrary PostMethodListRequest where arbitrary = genericArbitrary uniform
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
instance Arbitrary PostMethodListResponse where arbitrary = genericArbitrary uniform
data MethodCall = MethodCall
  { methodcallContractName :: Text
  , methodcallContractAddress :: Address
  , methodcallMethodName :: Text
  , methodcallArgs :: Map Text Text
  , methodcallValue :: Natural
  , methodcallTxParams :: Maybe TxParams
  } deriving (Eq,Show,Generic)
instance Arbitrary MethodCall where arbitrary = genericArbitrary uniform
instance ToJSON MethodCall where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON MethodCall where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
