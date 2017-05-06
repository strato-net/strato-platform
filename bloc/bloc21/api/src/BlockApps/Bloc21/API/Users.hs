{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE TypeOperators              #-}

module BlockApps.Bloc21.API.Users where

import           Control.Lens                     (mapped, (&), (?~))
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Types
import qualified Data.ByteString.Lazy             as ByteString.Lazy
import           Data.Map                         (Map)
import qualified Data.Map                         as Map
import           Data.Text                        (Text)
import qualified Data.Text.Encoding               as Text
import           Generic.Random.Generic
import           GHC.Generics
import           Numeric.Natural
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck
import           Test.QuickCheck.Instances        ()

import           BlockApps.Bloc21.API.SwaggerSchema
import           BlockApps.Bloc21.API.Utils
import           BlockApps.Bloc21.Crypto
import           BlockApps.Ethereum
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Types

--------------------------------------------------------------------------------
-- | Routes and types
--------------------------------------------------------------------------------

type GetUsers = "users" :> Get '[JSON] [UserName]

type GetUsersUser = "users"
  :> Capture "user" UserName
  :> Get '[JSON] [Address]

type PostUsersUser = "users"
  :> Capture "user" UserName
  :> QueryFlag "faucet"
  :> ReqBody '[JSON, FormUrlEncoded] Password
  :> Post '[JSON] Address

instance ToParam (QueryFlag "faucet") where
  toParam _ =
    DocQueryParam "faucet" ["0","1",""] "flag for fauceting a new user" Flag

--------------------------------------------------------------------------------

type PostUsersSend = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "send"
  :> ReqBody '[JSON] PostSendParameters
  :> Post '[JSON] PostTransaction

data PostSendParameters = PostSendParameters
  { sendToAddress :: Address
  , sendValue     :: Natural
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
    , sendValue = 10
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
        , sendValue = 10
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
  :> Post '[JSON] Address

data PostUsersContractRequest = PostUsersContractRequest
  { postuserscontractrequestSrc      :: Text
  , postuserscontractrequestPassword :: Password
  , postuserscontractrequestContract :: Text
  , postuserscontractrequestArgs     :: Maybe (Map Text ArgValue)
  , postuserscontractrequestTxParams :: Maybe TxParams
  , postuserscontractrequestValue :: Maybe Natural
  } deriving (Eq,Show,Generic)

instance Arbitrary PostUsersContractRequest where arbitrary = genericArbitrary uniform

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
    , postuserscontractrequestContract = "SimpleStorage"
    , postuserscontractrequestArgs = Nothing
    , postuserscontractrequestTxParams = Nothing
    , postuserscontractrequestValue = Just 1000000
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
        , postuserscontractrequestContract = "SimpleStorage"
        , postuserscontractrequestArgs = Nothing
        , postuserscontractrequestTxParams = Nothing
        , postuserscontractrequestValue = Just 1000000
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
  , uploadlistcontractValue        :: Maybe Natural
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
  :> Post '[JSON] PostUsersContractMethodResponse

data PostUsersContractMethodRequest = PostUsersContractMethodRequest
  { postuserscontractmethodPassword :: Password
  , postuserscontractmethodMethod   :: Text
  , postuserscontractmethodArgs     :: Map Text ArgValue
  , postuserscontractmethodValue    :: Natural
  , postuserscontractmethodTxParams :: Maybe TxParams
  } deriving (Eq,Show,Generic)

instance Arbitrary PostUsersContractMethodRequest where arbitrary = genericArbitrary uniform
instance ToJSON PostUsersContractMethodRequest where
  toJSON = genericToJSON (aesonPrefix camelCase){omitNothingFields = True}
instance FromJSON PostUsersContractMethodRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase){omitNothingFields = True}
instance ToSample PostUsersContractMethodRequest where
  toSamples _ = noSamples

newtype PostUsersContractMethodResponse = PostUsersContractMethodResponse
  { postusercontractmethodresponseReturns :: [SolidityValue]
  } deriving (Eq,Show,Generic,Arbitrary)
instance ToJSON PostUsersContractMethodResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostUsersContractMethodResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostUsersContractMethodResponse where
  toSamples _ = singleSample $
    PostUsersContractMethodResponse [SolidityValueAsString "return"]

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
       , postuserscontractmethodValue = 0 :: Natural
       , postuserscontractmethodTxParams = Nothing
       }

instance ToSchema PostUsersContractMethodResponse where
    declareNamedSchema = const . pure . named "Post contract response" $
      sketchSchema (PostUsersContractMethodResponse [SolidityValueAsString "I am a contract response"])

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
        , sendtransactionValue = 12
        , sendtransactionTxParams = Just (TxParams (Just $ Gas 123) (Just $ Wei 345)
            (Just $ Nonce 9876))
        }

data SendTransaction = SendTransaction
  { sendtransactionToAddress :: Address
  , sendtransactionValue     :: Natural
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
        , sendtransactionValue = 12
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
  :> Post '[JSON] [PostUsersContractMethodListResponse]

data PostUsersContractMethodListResponse
  = MethodHash Keccak256
  | MethodResolved [SolidityValue]
  deriving (Eq,Show,Generic)

instance ToJSON PostUsersContractMethodListResponse
instance FromJSON PostUsersContractMethodListResponse

instance ToSample PostUsersContractMethodListResponse where
  toSamples _ = samples
    [ MethodHash (keccak256 "foo")
    , MethodResolved [SolidityValueAsString "result"]
    ]

instance ToSchema PostUsersContractMethodListResponse where
 declareNamedSchema = const . pure . named "Post contract response" $
   sketchSchema (MethodResolved [SolidityValueAsString "I am a contract response"])

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
        , methodcallValue = 10
        , methodcallArgs = Map.fromList [("user", ArgString "Bob"), ("age", ArgInt 52)]
        , methodcallMethodName = "getHoroscope"
        , methodcallContractAddress = Address 0xdeadbeef
        , methodcallContractName = "HorroscopeApp"
        }

data MethodCall = MethodCall
  { methodcallContractName    :: Text
  , methodcallContractAddress :: Address
  , methodcallMethodName      :: Text
  , methodcallArgs            :: Map Text ArgValue
  , methodcallValue           :: Natural
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
        , methodcallValue = 10
        , methodcallArgs = Map.fromList [("user", ArgString "Bob"), ("age", ArgInt 52)]
        , methodcallMethodName = "getHoroscope"
        , methodcallContractAddress = Address 0xdeadbeef
        , methodcallContractName = "HoroscopeApp"
        }
