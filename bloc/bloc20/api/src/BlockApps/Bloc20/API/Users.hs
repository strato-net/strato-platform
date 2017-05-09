{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE TypeOperators              #-}

module BlockApps.Bloc20.API.Users where

import           Control.Lens                     (mapped, (&), (?~))
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Types
import qualified Data.ByteString.Lazy             as ByteString.Lazy
import qualified Data.ByteString.Lazy.Char8       as Lazy.Char8
import           Data.Map                         (Map)
import qualified Data.Map                         as Map
import           Data.Text                        (Text)
import qualified Data.Text                        as Text
import qualified Data.Text.Encoding               as Text
import           Generic.Random.Generic
import           GHC.Generics
import qualified Network.HTTP.Media               as M
import           Numeric.Natural
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck
import           Test.QuickCheck.Instances        ()
import           Web.FormUrlEncoded

import           BlockApps.Bloc20.API.SwaggerSchema
import           BlockApps.Bloc20.API.Utils
import           BlockApps.Bloc20.Crypto
import           BlockApps.Ethereum
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Types

--------------------------------------------------------------------------------
-- | Routes and types
--------------------------------------------------------------------------------

type GetUsers = "users" :> Get '[HTMLifiedJSON, JSON] [UserName]

type GetUsersUser = "users"
  :> Capture "user" UserName
  :> Get '[HTMLifiedJSON, JSON] [Address]

type PostUsersUser = "users"
  :> Capture "user" UserName
  :> ReqBody '[JSON, FormUrlEncoded] PostUsersUserRequest
  :> Post '[HTMLifiedAddress, JSON] Address

data PostUsersUserRequest = PostUsersUserRequest
  { userFaucet :: Text
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
    { userFaucet = "1"
    , userPassword = "securePassword"
    }

instance ToSchema PostUsersUserRequest where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Form to create a user"
    & mapped.schema.example ?~ toJSON (PostUsersUserRequest "1" "myPassword")

--------------------------------------------------------------------------------

type PostUsersSend = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "send"
  :> ReqBody '[JSON] PostSendParameters
  :> Post '[HTMLifiedJSON, JSON] PostTransaction

data PostSendParameters = PostSendParameters
  { sendToAddress :: Address
  , sendValue     :: Strung Natural
  , sendPassword  :: Password
  , sendTxParams  :: Maybe TxParams
  } deriving (Eq, Show, Generic)

instance Arbitrary PostSendParameters where arbitrary = genericArbitrary uniform

instance ToJSON PostSendParameters where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostSendParameters where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostSendParameters where
  toSamples _ = singleSample PostSendParameters
    { sendToAddress = Address 0xdeadbeef
    , sendValue = Strung 10
    , sendPassword = "securePassword"
    , sendTxParams = Nothing
    }

instance ToSchema PostSendParameters where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Send ether from one account to another"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: PostSendParameters
      ex = PostSendParameters
        { sendToAddress = Address 0xdeadbeef
        , sendValue = Strung 10
        , sendPassword = "securePassword"
        , sendTxParams = Just $ TxParams
            (Just (Gas 123)) (Just (Wei 345)) (Just (Nonce 9876))
        }

--------------------------------------------------------------------------------

type PostUsersContract = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "contract"
  :> ReqBody '[JSON] PostUsersContractRequest
  :> Post '[HTMLifiedAddress, JSON] Address

data PostUsersContractRequest = PostUsersContractRequest
  { postuserscontractrequestSrc      :: Text
  , postuserscontractrequestPassword :: Password
  , postuserscontractrequestContract :: Maybe Text
  , postuserscontractrequestArgs     :: Maybe (Map Text ArgValue)
  , postuserscontractrequestTxParams :: Maybe TxParams
  , postuserscontractrequestValue :: Maybe (Strung Natural)
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
  toJSON = genericToJSON (aesonPrefix camelCase){omitNothingFields = True}

instance FromJSON PostUsersContractRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase){omitNothingFields = True}

instance ToSample PostUsersContractRequest where
  toSamples _ = singleSample PostUsersContractRequest
    { postuserscontractrequestSrc =
      "contract SimpleStorage { uint storedData; function set(uint x) \
      \{ storedData = x; } function get() returns (uint retVal) \
      \{ return storedData; } }"
    , postuserscontractrequestPassword = "securePassword"
    , postuserscontractrequestContract = Just "SimpleStorage"
    , postuserscontractrequestArgs = Nothing
    , postuserscontractrequestTxParams = Nothing
    , postuserscontractrequestValue = Just $ Strung 1000000
    }

instance ToSchema PostUsersContractRequest where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Post User Contract Request"
    & mapped.schema.example ?~ toJSON req
    where
      req = PostUsersContractRequest
        { postuserscontractrequestSrc =
          "contract SimpleStorage { uint storedData; function set(uint x) \
          \{ storedData = x; } function get() returns (uint retVal) \
          \{ return storedData; } }"
        , postuserscontractrequestPassword = "securePassword"
        , postuserscontractrequestContract = Just "SimpleStorage"
        , postuserscontractrequestArgs = Nothing
        , postuserscontractrequestTxParams = Nothing
        , postuserscontractrequestValue = Just $ Strung 1000000
        }

--------------------------------------------------------------------------------

type PostUsersUploadList = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "uploadList"
  :> ReqBody '[JSON] UploadListRequest
  :> Post '[JSON] [PostUsersUploadListResponse]

data UploadListRequest = UploadListRequest
  { uploadlistPassword  :: Password
  , uploadlistContracts :: [UploadListContract]
  , uploadlistResolve   :: Bool
  } deriving (Eq,Show,Generic)

instance ToJSON UploadListRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON UploadListRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance Arbitrary UploadListRequest where arbitrary = genericArbitrary uniform

instance ToSample UploadListRequest where
  toSamples _ = noSamples

instance ToSchema UploadListRequest where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Make a request to upload a list of contracts"
    & mapped.schema.example ?~ toJSON ex
    where
      exContract1 :: UploadListContract
      exContract1 = UploadListContract
        { uploadlistcontractContractName = "UserInfoContract"
        , uploadlistcontractArgs = Map.fromList [("user", ArgString "Bob"), ("age",ArgInt 1)]
        , uploadlistcontractTxParams = Just $ TxParams (Just $ Gas 123) (Just $ Wei 345) Nothing
        , uploadlistcontractValue = Nothing
        }
      exContract2 :: UploadListContract
      exContract2 = UploadListContract
        { uploadlistcontractContractName = "AccountsContract"
        , uploadlistcontractArgs = Map.fromList [("accountType", ArgString "Checking"), ("balance",ArgInt 10)]
        , uploadlistcontractTxParams = Nothing
        , uploadlistcontractValue = Nothing
        }
      ex :: UploadListRequest
      ex = UploadListRequest "SecretPassword" [exContract1, exContract2] True

data UploadListContract = UploadListContract
  { uploadlistcontractContractName :: Text
  , uploadlistcontractArgs         :: Map Text ArgValue
  , uploadlistcontractTxParams     :: Maybe TxParams
  , uploadlistcontractValue        :: Maybe (Strung Natural)
  } deriving (Eq,Show,Generic)

instance Arbitrary UploadListContract where arbitrary = genericArbitrary uniform

instance ToJSON UploadListContract where
  toJSON = genericToJSON (aesonPrefix camelCase){omitNothingFields = True}

instance FromJSON UploadListContract where
  parseJSON = genericParseJSON (aesonPrefix camelCase){omitNothingFields = True}

instance ToSchema UploadListContract where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "A contract in a list of to-upload contracts"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: UploadListContract
      ex = UploadListContract
        { uploadlistcontractContractName = "SampleContract"
        , uploadlistcontractArgs = Map.fromList [("user", ArgString "Bob"), ("age",ArgInt 1)]
        , uploadlistcontractTxParams = Just $ TxParams (Just $ Gas 123) (Just $ Wei 345) Nothing
        , uploadlistcontractValue = Nothing
        }

newtype PostUsersUploadListResponse = PostUsersUploadListResponse
  { contractJSON :: ContractDetails } deriving (Eq,Show,Generic)

instance ToSchema PostUsersUploadListResponse

instance Arbitrary PostUsersUploadListResponse where
  arbitrary = genericArbitrary uniform

instance ToJSON PostUsersUploadListResponse where
  toJSON (PostUsersUploadListResponse contractDetails) = object
    [ "contractJSON" .= Text.decodeUtf8 (ByteString.Lazy.toStrict (encode contractDetails)) ]

instance FromJSON PostUsersUploadListResponse where
  parseJSON = withObject "PostUsersUploadListResponse" $ \obj -> do
    str <- obj .: "contractJSON"
    case eitherDecode (ByteString.Lazy.fromStrict (Text.encodeUtf8 str)) of
      Left err      -> fail err
      Right details -> return $ PostUsersUploadListResponse details

instance ToSample PostUsersUploadListResponse where
  toSamples _ = noSamples



--------------------------------------------------------------------------------

-- This should return the return value from the method call
type PostUsersContractMethod = "users"
  :> Capture "user" UserName
  :> Capture "userAddress" Address
  :> "contract"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> "call"
  :> ReqBody '[JSON] PostUsersContractMethodRequest
  :> Post '[HTMLifiedPlainText, JSON] PostUsersContractMethodResponse

data PostUsersContractMethodRequest = PostUsersContractMethodRequest
  { postuserscontractmethodPassword :: Password
  , postuserscontractmethodMethod   :: Text
  , postuserscontractmethodArgs     :: Map Text ArgValue
  , postuserscontractmethodValue    :: Maybe (Strung Natural)
  , postuserscontractmethodTxParams :: Maybe TxParams
  } deriving (Eq,Show,Generic)

instance Arbitrary PostUsersContractMethodRequest where arbitrary = genericArbitrary uniform
instance ToJSON PostUsersContractMethodRequest where
  toJSON = genericToJSON (aesonPrefix camelCase){omitNothingFields = True}
instance FromJSON PostUsersContractMethodRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase){omitNothingFields = True}
instance ToSample PostUsersContractMethodRequest where
  toSamples _ = noSamples

newtype PostUsersContractMethodResponse = PostUsersContractMethodResponse Text deriving (Eq,Show,FromJSON,ToJSON,Arbitrary)
instance ToSample PostUsersContractMethodResponse where
  toSamples _ = noSamples --hack because endpoints are returning random text

instance ToSchema PostUsersContractMethodRequest where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "Post Users Contract Method Request"
    & mapped.schema.description ?~ "Everything you need to make a method request"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: PostUsersContractMethodRequest
      ex = PostUsersContractMethodRequest
       { postuserscontractmethodPassword = "MySecretPassword"
       , postuserscontractmethodMethod = "fireMissiles"
       , postuserscontractmethodArgs = Map.fromList [("arg1", ArgString "accessCodes"), ("arg2", ArgString "target")]
       , postuserscontractmethodValue = Just $ Strung 0
       , postuserscontractmethodTxParams = Nothing
       }
data PostUsersMethodResponse
  = PostUsersMethodResponse
  { postusersmethodresponseValues            :: Text
  , postusersmethodresponseTransactionResult :: TransactionResult
  }
  deriving (Eq,Show,Generic)
instance FromJSON PostUsersMethodResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToJSON PostUsersMethodResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance ToSchema PostUsersContractMethodResponse where
    declareNamedSchema = const . pure . named "Post contract response" $
      sketchSchema (PostUsersMethodResponse "I am a contract response" exampleTxResult)
instance ToSample PostUsersMethodResponse where
  toSamples _ = noSamples --hack because endpoints are returning random text

data HTMLifiedPlainText

instance Accept HTMLifiedPlainText where
  contentType _ = "text" M.// "html" M./: ("charset", "utf-8")

instance MimeUnrender HTMLifiedPlainText PostUsersContractMethodResponse where
  mimeUnrender _ = return . PostUsersContractMethodResponse . Text.pack . Lazy.Char8.unpack
instance MimeRender HTMLifiedPlainText PostUsersContractMethodResponse where
  mimeRender _ (PostUsersContractMethodResponse resp) =  Lazy.Char8.pack $ Text.unpack resp

instance MimeUnrender HTMLifiedPlainText PostUsersMethodResponse where
  mimeUnrender _ = error "why would you pay money for this. really, why?"

--------------------------------------------------------------------------------

-- POST /users/:user/:userAddress/sendList
type PostUsersSendList = "users"
  :> Capture "user" UserName
  :> Capture "userAddress" Address
  :> "sendList"
  :> ReqBody '[JSON] PostSendListRequest
  :> Post '[JSON] [PostSendListResponse]

data PostSendListRequest = PostSendListRequest
  { postsendlistrequestPassword :: Password
  , postsendlistrequestResolve  :: Bool
  , postsendlistrequestTxs      :: [SendTransaction]
  } deriving (Eq,Show,Generic)

instance Arbitrary PostSendListRequest where arbitrary = genericArbitrary uniform

instance ToJSON PostSendListRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostSendListRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostSendListRequest where
  toSamples _ = noSamples

instance ToSchema PostSendListRequest where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "Post Users Send List Request"
    & mapped.schema.description ?~ "Send a list of users some ether"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: PostSendListRequest
      ex = PostSendListRequest
        { postsendlistrequestPassword = "MyPassword"
        , postsendlistrequestResolve = False
        , postsendlistrequestTxs = [sendEx]
        }
      sendEx :: SendTransaction
      sendEx = SendTransaction
        { sendtransactionToAddress = Address 0xdeadbeef
        , sendtransactionValue = Strung 12
        , sendtransactionTxParams = Just (TxParams (Just $ Gas 123) (Just $ Wei 345)
            (Just $ Nonce 9876))
        }

data SendTransaction = SendTransaction
  { sendtransactionToAddress :: Address
  , sendtransactionValue     :: Strung Natural
  , sendtransactionTxParams  :: Maybe TxParams
  } deriving (Eq,Show,Generic)

instance Arbitrary SendTransaction where arbitrary = genericArbitrary uniform

instance ToJSON SendTransaction where
  toJSON = genericToJSON (aesonPrefix camelCase){omitNothingFields = True}

instance FromJSON SendTransaction where
  parseJSON = genericParseJSON (aesonPrefix camelCase){omitNothingFields = True}

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


instance ToSchema PostSendListResponse where
  declareNamedSchema = const . pure . named "Post Send List response" $
    sketchSchema (PostSendListResponse "I am a send listresponse")

instance ToSchema SendTransaction where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "Send Transaction"
    & mapped.schema.description ?~ "Single transaction for batch"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: SendTransaction
      ex = SendTransaction
        { sendtransactionToAddress = Address 0xdeadbeef
        , sendtransactionValue = Strung 12
        , sendtransactionTxParams = Just (TxParams (Just $ Gas 123) (Just $ Wei 345)
            (Just $ Nonce 9876))
        }

--------------------------------------------------------------------------------

--POST /users/:user/:address/callList
type PostUsersContractMethodList = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "callList"
  :> ReqBody '[JSON] PostMethodListRequest
  :> Post '[JSON] [PostMethodListResponse]

data PostMethodListRequest = PostMethodListRequest
  { postmethodlistrequestPassword :: Password
  , postmethodlistrequestResolve  :: Bool
  , postmethodlistrequestTxs      :: [MethodCall]
  } deriving (Eq,Show,Generic)

instance Arbitrary PostMethodListRequest where arbitrary = genericArbitrary uniform

instance ToJSON PostMethodListRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostMethodListRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostMethodListRequest where
  toSamples _ = noSamples

instance ToSchema PostMethodListRequest where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "Post Method List Request"
    & mapped.schema.description ?~ "Everything you need to batch method calls"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: PostMethodListRequest
      ex = PostMethodListRequest
        { postmethodlistrequestPassword = "MyPassword"
        , postmethodlistrequestResolve = True
        , postmethodlistrequestTxs = [exMethodCall]
        }
      exMethodCall :: MethodCall
      exMethodCall = MethodCall
        { methodcallTxParams = Nothing
        , methodcallValue = Strung 10
        , methodcallArgs = Map.fromList [("user", ArgString "Bob"), ("age", ArgInt 52)]
        , methodcallMethodName = "getHoroscope"
        , methodcallContractAddress = Address 0xdeadbeef
        , methodcallContractName = "HorroscopeApp"
        }

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

instance ToSchema PostMethodListResponse

data MethodCall = MethodCall
  { methodcallContractName    :: Text
  , methodcallContractAddress :: Address
  , methodcallMethodName      :: Text
  , methodcallArgs            :: Map Text ArgValue
  , methodcallValue           :: Strung Natural
  , methodcallTxParams        :: Maybe TxParams
  } deriving (Eq,Show,Generic)

instance Arbitrary MethodCall where arbitrary = genericArbitrary uniform

instance ToJSON MethodCall where
  toJSON = genericToJSON (aesonPrefix camelCase){omitNothingFields = True}

instance FromJSON MethodCall where
  parseJSON = genericParseJSON (aesonPrefix camelCase){omitNothingFields = True}

instance ToSchema MethodCall where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "Method Call"
    & mapped.schema.description ?~ "Everything you'll need for a method call"
    & mapped.schema.example ?~ toJSON ex
    where
      ex ::MethodCall
      ex = MethodCall
        { methodcallTxParams = Nothing
        , methodcallValue = Strung 10
        , methodcallArgs = Map.fromList [("user", ArgString "Bob"), ("age", ArgInt 52)]
        , methodcallMethodName = "getHoroscope"
        , methodcallContractAddress = Address 0xdeadbeef
        , methodcallContractName = "HoroscopeApp"
        }
