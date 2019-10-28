{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DuplicateRecordFields      #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedLists            #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE ScopedTypeVariables        #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeOperators              #-}

module BlockApps.Bloc22.API.Users where

import           Control.Lens                       (mapped)
import           Control.Lens.Operators             hiding ((.=))
import           Control.Lens.TH
import           Data.Aeson                         hiding (Success)
import           Data.Aeson.Casing
import qualified Data.ByteString.Lazy               as ByteString.Lazy
import           Data.Map                           (Map)
import qualified Data.Map                           as Map
import           Data.Proxy
import           Data.Text                          (Text)
import qualified Data.Text.Encoding                 as Text
import qualified Generic.Random                     as GR
import           GHC.Generics
import           Numeric.Natural
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck                    hiding (Success,Failure)

import           BlockApps.Bloc22.API.SwaggerSchema
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Crypto
import           BlockApps.Ethereum
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Types


--------------------------------------------------------------------------------
-- | Routes and types
--------------------------------------------------------------------------------

data BlocTransactionStatus = Success | Failure | Pending deriving (Eq,Show,Generic)

instance Arbitrary BlocTransactionStatus where
  arbitrary = GR.genericArbitrary GR.uniform

instance FromJSON BlocTransactionStatus where
  parseJSON = genericParseJSON defaultOptions

instance ToJSON BlocTransactionStatus where
  toJSON = genericToJSON defaultOptions

instance ToSchema BlocTransactionStatus where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Bloc Transaction Status"
    & mapped.schema.example ?~ toJSON Success

data BlocTransactionData = Send   PostTransaction
                         | Upload ContractDetails
                         | Call   [SolidityValue]
                         deriving (Eq,Show,Generic)

instance Arbitrary BlocTransactionData where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON BlocTransactionData where
  toJSON btd = case btd of
    Send   transaction -> object [ "tag" .= ("Send" :: Text)
                                 , "contents" .= (transaction::PostTransaction)
                                 ]
    Upload details     -> object [ "tag" .= ("Upload":: Text)
                                 , "contents" .= (details::ContractDetails)
                                 ]
    Call   solVals     -> object [ "tag" .= ("Call":: Text)
                                 , "contents" .= (solVals::[SolidityValue])
                                 ]

instance FromJSON BlocTransactionData where
  parseJSON = withObject "BlocTransactionData" $ \v -> do
    tag <- v .: "tag"
    case tag of
      ("Send"  ::String) -> Send   <$> v .: "contents"
      ("Upload"::String) -> Upload <$> v .: "contents"
      _                  -> Call   <$> v .: "contents"


instance ToSample BlocTransactionData where
  toSamples _ = samples
    [ Send PostTransaction {
        posttransactionHash       = keccak256 "foo"
      , posttransactionGasLimit   = 100000
      , posttransactionCodeOrData = "Code or Data"
      , posttransactionGasPrice   = 1
      , posttransactionTo         = Just $ Address 0xdeadbeef
      , posttransactionFrom       = Address 0x12345678
      , posttransactionValue      = Strung 0
      , posttransactionR          = Hex 0xdeadbeef
      , posttransactionS          = Hex 0xdeadbeef
      , posttransactionV          = Hex 0x1c
      , posttransactionNonce      = 9876
      , posttransactionChainId    = Nothing
      , posttransactionMetadata   = Nothing
      }
    , Upload ContractDetails {
        contractdetailsBin        = "Contract Bin"
      , contractdetailsAddress    = Just (Named "Latest")
      , contractdetailsBinRuntime = "Contract Bin Runtime"
      , contractdetailsCodeHash   = EVMCode $ keccak256SHA $ keccak256 "Contract Code Hash"
      , contractdetailsName       = "Example"
      , contractdetailsSrc        = "contract Example { }"
      , contractdetailsXabi       = sampleXabi
      , contractdetailsChainId    = Nothing
      }
    , Call [] -- probably make a better Call sample
    ]

instance ToSchema BlocTransactionData where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped.name ?~ "Bloc Transaction Data"
      & mapped.schema.description ?~ "Bloc Transaction Data"
      & mapped.schema.example ?~ toJSON ex
      where
        ex :: BlocTransactionData
        ex = Call [] -- probably make a better ToSchema example

data BlocTransactionResult = BlocTransactionResult
  { blocTransactionStatus   :: BlocTransactionStatus
  , blocTransactionHash     :: Keccak256
  , blocTransactionTxResult :: Maybe TransactionResult
  , blocTransactionData     :: Maybe BlocTransactionData
  } deriving (Eq, Show, Generic)

instance Arbitrary BlocTransactionResult where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON BlocTransactionResult where
  toJSON = genericToJSON (aesonDrop 15 camelCase)

instance FromJSON BlocTransactionResult where
  parseJSON = genericParseJSON (aesonDrop 15 camelCase)

instance ToSample BlocTransactionResult where
  toSamples _ = singleSample BlocTransactionResult
    { blocTransactionStatus = Success
    , blocTransactionHash = keccak256 "foo"
    , blocTransactionTxResult = Nothing
    , blocTransactionData = Nothing
    }

instance ToSchema BlocTransactionResult where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Bloc Transaction Result"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: BlocTransactionResult
      ex = BlocTransactionResult
        { blocTransactionStatus = Success
        , blocTransactionHash = keccak256 "foo"
        , blocTransactionTxResult = Nothing
        , blocTransactionData = Nothing
        }

type GetBlocTransactionResult = "transactions"
  :> Capture "hash" Keccak256
  :> "result"
  :> QueryParam "chainid" ChainId
  :> QueryFlag "resolve"
  :> Get '[JSON] BlocTransactionResult

type PostBlocTransactionResults = "transactions"
  :> "results"
  :> QueryParam "chainid" ChainId
  :> QueryFlag "resolve"
  :> ReqBody '[JSON] [Keccak256]
  :> Post '[JSON] [BlocTransactionResult]

type GetUsers = "users" :> Get '[JSON] [UserName]

type GetUsersUser = "users"
  :> Capture "user" UserName
  :> Get '[JSON] [Address]


type PostUsersUser = "users"
  :> Capture "user" UserName
  :> ReqBody '[JSON, FormUrlEncoded] Password
  :> Post '[JSON] Address

instance ToParam (QueryFlag "resolve") where
  toParam _ =
    DocQueryParam "resolve" ["0","1",""] "flag for resolving a transaction result" Flag

-- It would probably better to use the Authorization header
-- and make this a GET request.
type GetUsersKeyStore = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "keystore"
  :> ReqBody '[JSON, FormUrlEncoded] Password
  :> Post '[JSON] KeyStore


type PostUsersKeyStore = "users"
  :> Capture "user" UserName
  :> "keystore"
  :> ReqBody '[JSON] PostUsersKeyStoreRequest
  :> Post '[JSON] Bool

data PostUsersKeyStoreRequest = PostUsersKeyStoreRequest
  { postuserskeystorerequestPassword :: Password
  , postuserskeystorerequestKeyStore :: KeyStore
  } deriving (Eq, Show, Generic)

instance Arbitrary PostUsersKeyStoreRequest where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON PostUsersKeyStoreRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostUsersKeyStoreRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostUsersKeyStoreRequest where
  toSamples _ = noSamples

instance ToSchema PostUsersKeyStoreRequest where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "KeyStore entry"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: PostUsersKeyStoreRequest
      ex = PostUsersKeyStoreRequest (Password "hunter2") exKeyStore
--------------------------------------------------------------------------------

type PostUsersFill = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "fill"
  :> QueryFlag "resolve"
  :> Post '[JSON] BlocTransactionResult

type PostUsersSend = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "send"
  :> QueryParam "chainid" ChainId
  :> QueryFlag "resolve"
  :> ReqBody '[JSON] PostSendParameters
  :> Post '[JSON] BlocTransactionResult

data PostSendParameters = PostSendParameters
  { sendToAddress :: Address
  , sendValue     :: Strung Natural
  , sendPassword  :: Password
  , sendTxParams  :: Maybe TxParams
  , sendMetadata  :: Maybe (Map Text Text)
  } deriving (Eq, Show, Generic)

instance Arbitrary PostSendParameters where arbitrary = GR.genericArbitrary GR.uniform

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
    , sendMetadata = Nothing
    }

instance ToSchema PostSendParameters where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Send ether from one account to another (value is in Wei)"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: PostSendParameters
      ex = PostSendParameters
        { sendToAddress = Address 0xdeadbeef
        , sendValue = Strung 100000000
        , sendPassword = "securePassword"
        , sendTxParams = Nothing
        , sendMetadata = Nothing
        }

data TransferParameters = TransferParameters
  { fromAddress :: Address
  , toAddress   :: Address
  , value       :: Strung Natural
  , txParams    :: Maybe TxParams
  , metadata    :: Maybe (Map Text Text)
  , chainId     :: Maybe ChainId
  , resolve     :: Bool
  } deriving (Eq, Show, Generic)

--------------------------------------------------------------------------------

type PostUsersContract = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "contract"
  :> QueryParam "chainid" ChainId
  :> QueryFlag "resolve"
  :> ReqBody '[JSON] PostUsersContractRequest
  :> Post '[JSON] BlocTransactionResult

data PostUsersContractRequest = PostUsersContractRequest
  { postuserscontractrequestSrc      :: Text
  , postuserscontractrequestPassword :: Password
  , postuserscontractrequestContract :: Maybe Text
  , postuserscontractrequestArgs     :: Maybe (Map Text ArgValue)
  , postuserscontractrequestTxParams :: Maybe TxParams
  , postuserscontractrequestValue    :: Maybe (Strung Natural)
  , postuserscontractrequestMetadata :: Maybe (Map Text Text)
  } deriving (Eq,Show,Generic)

instance Arbitrary PostUsersContractRequest where arbitrary = GR.genericArbitrary GR.uniform

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
    , postuserscontractrequestValue = Just $ Strung 10
    , postuserscontractrequestMetadata = Nothing
    }

instance ToSchema PostUsersContractRequest where
  declareNamedSchema _ = do
    textSchema <- declareSchemaRef (Proxy :: Proxy Text)
    pwSchema <- declareSchemaRef (Proxy :: Proxy Password)
    contractNameSchema <- declareSchemaRef (Proxy :: Proxy (Maybe Text))
    argsSchema <- declareSchemaRef (Proxy :: Proxy (Maybe (Map Text ArgValue)))
    txParamsSchema <- declareSchemaRef (Proxy :: Proxy (Maybe TxParams))
    metadataSchema <- declareSchemaRef (Proxy :: Proxy (Maybe (Map Text Text)))
    return $ NamedSchema (Just "Post Users Contract Request")
      ( mempty
        & type_ .~ SwaggerObject
        & properties .~
            [ ("src", textSchema & mapped.description ?~ "Solidity source code")
            , ("password", pwSchema)
            , ("contract", contractNameSchema & mapped.description ?~ "Contract name")
            , ("args", argsSchema)
            , ("txParams", txParamsSchema)
            , ("value", textSchema & mapped.description ?~ "Contract value in Eth")
            , ("metadata", metadataSchema)
            ]
        & required .~ [ "src"
                      , "password"
                      ]
        & description ?~ "Post Users Contract Request"
        & example ?~ toJSON PostUsersContractRequest
            { postuserscontractrequestSrc =
              "contract SimpleStorage { uint storedData; function set(uint x) \
              \{ storedData = x; } function get() returns (uint retVal) \
              \{ return storedData; } }"
            , postuserscontractrequestPassword = "securePassword"
            , postuserscontractrequestContract = Just "SimpleStorage"
            , postuserscontractrequestArgs = Nothing
            , postuserscontractrequestTxParams = Nothing
            , postuserscontractrequestValue = Nothing
            , postuserscontractrequestMetadata = Nothing
            }
      )

data ContractParameters = ContractParameters
  { fromAddr :: Address
  , src      :: Text
  , contract :: Maybe Text
  , args     :: Maybe (Map Text ArgValue)
  , value    :: Maybe (Strung Natural)
  , txParams :: Maybe TxParams
  , metadata :: Maybe (Map Text Text)
  , chainId  :: Maybe ChainId
  , resolve  :: Bool
  }
--------------------------------------------------------------------------------

type PostUsersUploadList = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "uploadList"
  :> QueryParam "chainid" ChainId
  :> QueryFlag "resolve"
  :> ReqBody '[JSON] UploadListRequest
  :> Post '[JSON] [BlocTransactionResult]

data UploadListRequest = UploadListRequest
  { uploadlistPassword  :: Password
  , uploadlistContracts :: [UploadListContract]
  , uploadlistResolve   :: Bool
  } deriving (Eq,Show,Generic)

instance ToJSON UploadListRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON UploadListRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance Arbitrary UploadListRequest where arbitrary = GR.genericArbitrary GR.uniform

instance ToSample UploadListRequest where
  toSamples _ = noSamples

instance ToSchema UploadListRequest where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Make a request to upload a list of contracts"
    & mapped.schema.example ?~ toJSON ex
    where
      exContract1 :: UploadListContract
      exContract1 = UploadListContract
        { uploadlistcontractContractName = "AccountsContract"
        , uploadlistcontractArgs = Map.fromList [("accountType", ArgString "Checking"), ("balance",ArgInt 10)]
        , _uploadlistcontractTxParams = Nothing
        , uploadlistcontractValue = Nothing
        , uploadlistcontractMetadata = Nothing
        }
      ex :: UploadListRequest
      ex = UploadListRequest "SecretPassword" [exContract1] True

data UploadListContract = UploadListContract
  { uploadlistcontractContractName :: Text
  , uploadlistcontractArgs         :: Map Text ArgValue
  , _uploadlistcontractTxParams    :: Maybe TxParams
  , uploadlistcontractValue        :: Maybe (Strung Natural)
  , uploadlistcontractMetadata     :: Maybe (Map Text Text)
  } deriving (Eq,Show,Generic)
makeLenses ''UploadListContract

instance Arbitrary UploadListContract where arbitrary = GR.genericArbitrary GR.uniform

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
        , _uploadlistcontractTxParams = Just $ TxParams (Just $ Gas 123) (Just $ Wei 345) Nothing
        , uploadlistcontractValue = Nothing
        , uploadlistcontractMetadata = Nothing
        }

newtype PostUsersUploadListResponse = PostUsersUploadListResponse
  { contractJSON :: ContractDetails } deriving (Eq,Show,Generic)

instance ToSchema PostUsersUploadListResponse

instance Arbitrary PostUsersUploadListResponse where
  arbitrary = GR.genericArbitrary GR.uniform

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

data ContractListParameters = ContractListParameters
  { fromAddr  :: Address
  , contracts :: [UploadListContract]
  , chainId   :: Maybe ChainId
  , resolve   :: Bool
  } deriving (Eq,Show,Generic)

--------------------------------------------------------------------------------

-- This should return the return value from the method call
type PostUsersContractMethod = "users"
  :> Capture "user" UserName
  :> Capture "userAddress" Address
  :> "contract"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> "call"
  :> QueryParam "chainid" ChainId
  :> QueryFlag "resolve"
  :> ReqBody '[JSON] PostUsersContractMethodRequest
  :> Post '[JSON] BlocTransactionResult

data PostUsersContractMethodRequest = PostUsersContractMethodRequest
  { postuserscontractmethodPassword :: Password
  , postuserscontractmethodMethod   :: Text
  , postuserscontractmethodArgs     :: Map Text ArgValue
  , postuserscontractmethodValue    :: Maybe (Strung Natural)
  , postuserscontractmethodTxParams :: Maybe TxParams
  , postuserscontractmethodMetadata :: Maybe (Map Text Text)
  } deriving (Eq,Show,Generic)

instance Arbitrary PostUsersContractMethodRequest where arbitrary = GR.genericArbitrary GR.uniform
instance ToJSON PostUsersContractMethodRequest where
  toJSON = genericToJSON (aesonPrefix camelCase){omitNothingFields = True}
instance FromJSON PostUsersContractMethodRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase){omitNothingFields = True}
instance ToSample PostUsersContractMethodRequest where
  toSamples _ = noSamples

newtype PostUsersContractMethodResponse = PostUsersContractMethodResponse
  { postusercontractmethodresponseReturns :: [SolidityValue]
  } deriving (Eq,Show,Generic)
    deriving newtype (Arbitrary)

instance ToJSON PostUsersContractMethodResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON PostUsersContractMethodResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample PostUsersContractMethodResponse where
  toSamples _ = singleSample $
    PostUsersContractMethodResponse [SolidityValueAsString "return"]

instance ToSchema PostUsersContractMethodRequest where
  declareNamedSchema _ = do
    textSchema <- declareSchemaRef (Proxy :: Proxy Text)
    pwSchema <- declareSchemaRef (Proxy :: Proxy Password)
    argsSchema <- declareSchemaRef (Proxy :: Proxy (Map Text ArgValue))
    txParamsSchema <- declareSchemaRef (Proxy :: Proxy (Maybe TxParams))
    metadataSchema <- declareSchemaRef (Proxy :: Proxy (Maybe (Map Text Text)))
    return $ NamedSchema (Just "Post Users Contract Method Request")
      ( mempty
        & type_ .~ SwaggerObject
        & properties .~
            [ ("password", pwSchema)
            , ("method", textSchema & mapped.description ?~ "Method name")
            , ("args", argsSchema)
            , ("value", textSchema & mapped.description ?~ "Method value in Eth")
            , ("txParams", txParamsSchema)
            , ("metadata", metadataSchema)
            ]
        & required .~ [ "password", "method", "args" ]
        & description ?~ "Post Users Contract Method Request"
        & example ?~ toJSON PostUsersContractMethodRequest
            { postuserscontractmethodPassword = "securePassword"
            , postuserscontractmethodMethod = "get"
            , postuserscontractmethodArgs = Map.empty
            , postuserscontractmethodValue = Just $ Strung 0
            , postuserscontractmethodTxParams = Nothing
            , postuserscontractmethodMetadata = Nothing
            }
      )

instance ToSchema PostUsersContractMethodResponse where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "Post Users Contract Method Response"
    & mapped.schema.description ?~ "Post Users Contract Method Response"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: PostUsersContractMethodResponse
      ex = PostUsersContractMethodResponse
        { postusercontractmethodresponseReturns =
          [ SolidityValueAsString "tomahawk"
          , SolidityValueAsString "2"
          , SolidityBool True
          ]
        }

data FunctionParameters = FunctionParameters
  { fromAddr     :: Address
  , contractName :: Text
  , contractAddr :: Address
  , funcName     :: Text
  , args         :: Map Text ArgValue
  , value        :: Maybe (Strung Natural)
  , txParams     :: Maybe TxParams
  , metadata     :: Maybe (Map Text Text)
  , chainId      :: Maybe ChainId
  , resolve      :: Bool
  }
--------------------------------------------------------------------------------

-- POST /users/:user/:userAddress/sendList
type PostUsersSendList = "users"
  :> Capture "user" UserName
  :> Capture "userAddress" Address
  :> "sendList"
  :> QueryParam "chainid" ChainId
  :> QueryFlag "resolve"
  :> ReqBody '[JSON] PostSendListRequest
  :> Post '[JSON] [BlocTransactionResult]

data PostSendListRequest = PostSendListRequest
  { postsendlistrequestPassword :: Password
  , postsendlistrequestResolve  :: Bool
  , postsendlistrequestTxs      :: [SendTransaction]
  } deriving (Eq,Show,Generic)

instance Arbitrary PostSendListRequest where arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON PostSendListRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostSendListRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostSendListRequest where
  toSamples _ = noSamples

instance ToSchema PostSendListRequest where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "Post Users Send List Request"
    & mapped.schema.description ?~ "Send a list of users some ether (value in Wei)"
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
        , sendtransactionValue = Strung 1000000000000000
        , _sendtransactionTxParams = Just (TxParams (Just $ Gas 123) (Just $ Wei 345)
            (Just $ Nonce 9876))
        , sendtransactionMetadata = (Just $ Map.fromList [("purpose","groceries")])
        }

data SendTransaction = SendTransaction
  { sendtransactionToAddress :: Address
  , sendtransactionValue     :: Strung Natural
  , _sendtransactionTxParams :: Maybe TxParams
  , sendtransactionMetadata  :: Maybe (Map Text Text)
  } deriving (Eq,Show,Generic)
makeLenses ''SendTransaction

instance Arbitrary SendTransaction where arbitrary = GR.genericArbitrary GR.uniform

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
  arbitrary = GR.genericArbitrary GR.uniform


instance ToSchema PostSendListResponse where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "Post Users Send List Response"
    & mapped.schema.description ?~ "Post Users Send List Response"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: PostSendListResponse
      ex = PostSendListResponse
        { postsendlistresponseSenderBalance = "1000"
        }

instance ToSchema SendTransaction where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "Send Transaction"
    & mapped.schema.description ?~ "Single transaction for batch"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: SendTransaction
      ex = SendTransaction
        { sendtransactionToAddress = Address 0xdeadbeef
        , sendtransactionValue = Strung 100000000000000
        , _sendtransactionTxParams = Just (TxParams (Just $ Gas 123) (Just $ Wei 345)
            (Just $ Nonce 9876))
        , sendtransactionMetadata = (Just $ Map.fromList [("purpose","groceries")])
        }

data TransferListParameters = TransferListParameters
  { fromAddr :: Address
  , txs      :: [SendTransaction]
  , chainId  :: Maybe ChainId
  , resolve  :: Bool
  } deriving (Show, Eq)

--------------------------------------------------------------------------------

--POST /users/:user/:address/callList
type PostUsersContractMethodList = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "callList"
  :> QueryParam "chainid" ChainId
  :> QueryFlag "resolve"
  :> ReqBody '[JSON] PostMethodListRequest
  :> Post '[JSON] [BlocTransactionResult]

data PostUsersContractMethodListResponse
  = MethodHash Keccak256
  -- | MethodResolved [SolidityValue]
  | MethodResolved (Either MethodErrored [SolidityValue])
  deriving (Eq,Show,Generic)


instance Arbitrary PostUsersContractMethodListResponse where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON PostUsersContractMethodListResponse where
  toJSON mlr = case mlr of
    MethodHash kc     -> object [ "tag" .= ("MethodHash" :: Text)
                                , "contents" .= (kc::Keccak256)
                                ]
    MethodResolved (Left err) -> object [ "tag" .= ("MethodResolved":: Text)
                                        , "contents" .= (err::MethodErrored)
                                        , "status" .= ("failed"::Text)
                                        ]
    MethodResolved (Right solVals) -> object [ "tag" .= ("MethodResolved":: Text)
                                             , "contents" .= (solVals::[SolidityValue])
                                             , "status" .= ("success"::Text)
                                             ]

instance FromJSON PostUsersContractMethodListResponse where
  parseJSON = withObject "PostUsersContractMethodListResponse" $ \v -> do
    tag <- v .: "tag"
    case tag of
      ("MethodResolved"::String) -> do
        status <- v .: "status"
        case status of
          ("success"::String) -> MethodResolved <$> (Right <$> v .: "contents")
          ("fail"::String)    -> MethodResolved <$> (Left <$> v .: "contents")
          _ -> fail "failed to parseJSON on key `status` of PostUsersContractMethodListResponse"
      _                          -> MethodHash <$> v .: "contents"


instance ToSample PostUsersContractMethodListResponse where
  toSamples _ = samples
    [ MethodHash (keccak256 "foo")
    , MethodResolved $ Right
       [ SolidityValueAsString "1"
       , SolidityValueAsString "two"
       , SolidityValueAsString "buckleMyShoe"
       ]
    ]

instance ToSchema PostUsersContractMethodListResponse where
 declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
     & mapped.name ?~ "Post Users Contract Method List Response"
     & mapped.schema.description ?~ "Post Users Contract Method List Response"
     & mapped.schema.example ?~ toJSON ex
     where
       ex :: PostUsersContractMethodListResponse
       ex = MethodResolved $ Right
         [ SolidityValueAsString "1"
         , SolidityValueAsString "two"
         , SolidityValueAsString "buckleMyShoe"
         ]

data MethodErrored = MethodErrored { erroredMethodCall :: MethodCall
                                   , errorMessage      :: Text
                                   }
  deriving (Eq,Show,Generic)

instance Arbitrary MethodErrored where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON MethodErrored
instance FromJSON MethodErrored

methodErroredExample :: MethodErrored
methodErroredExample =
  MethodErrored { erroredMethodCall = exMethodCall
                , errorMessage      = "Rejected from mempool at \
                   \ Execution/Queued due to low account balance \
                   \ (expected: 1234000000000100000000, actual: 999999999999995067249)"
                }
  where
     exMethodCall :: MethodCall
     exMethodCall = MethodCall
       { _methodcallTxParams = Nothing
       , methodcallValue = Strung 1000000000
       , methodcallArgs = Map.fromList [("user", ArgString "Bob"), ("age", ArgInt 52)]
       , methodcallMethodName = "getHoroscope"
       , methodcallContractAddress = Address 0xdeadbeef
       , methodcallContractName = "HoroscopeApp"
       , methodcallMetadata = Nothing
       }


instance ToSample MethodErrored where
  toSamples _ = samples [methodErroredExample]

instance ToSchema MethodErrored where
 declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
     & mapped.name ?~ "Method Errored Response"
     & mapped.schema.description ?~ "response object when method fails in a methodList call"
     & mapped.schema.example ?~ toJSON methodErroredExample

data PostMethodListRequest = PostMethodListRequest
  { postmethodlistrequestPassword :: Password
  , postmethodlistrequestResolve  :: Bool
  , postmethodlistrequestTxs      :: [MethodCall]
  } deriving (Eq,Show,Generic)

instance Arbitrary PostMethodListRequest where arbitrary = GR.genericArbitrary GR.uniform

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
        { _methodcallTxParams = Nothing
        , methodcallValue = Strung 1000000000
        , methodcallArgs = Map.fromList [("user", ArgString "Bob"), ("age", ArgInt 52)]
        , methodcallMethodName = "getHoroscope"
        , methodcallContractAddress = Address 0xdeadbeef
        , methodcallContractName = "HoroscopeApp"
        , methodcallMetadata = Nothing
        }

data MethodCall = MethodCall
  { methodcallContractName    :: Text
  , methodcallContractAddress :: Address
  , methodcallMethodName      :: Text
  , methodcallArgs            :: Map Text ArgValue
  , methodcallValue           :: Strung Natural
  , _methodcallTxParams       :: Maybe TxParams
  , methodcallMetadata        :: Maybe (Map Text Text)
  } deriving (Eq,Show,Generic)
makeLenses ''MethodCall

instance Arbitrary MethodCall where arbitrary = GR.genericArbitrary GR.uniform

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
        { _methodcallTxParams = Nothing
        , methodcallValue = Strung 1000000000
        , methodcallArgs = Map.fromList [("user", ArgString "Bob"), ("age", ArgInt 52)]
        , methodcallMethodName = "getHoroscope"
        , methodcallContractAddress = Address 0xdeadbeef
        , methodcallContractName = "HoroscopeApp"
        , methodcallMetadata = Nothing
        }

data FunctionListParameters = FunctionListParameters
  { fromAddr :: Address
  , txs      :: [MethodCall]
  , chainId  :: Maybe ChainId
  , resolve  :: Bool
  } deriving (Show, Eq)
