{-# LANGUAGE
    Arrows
  , DataKinds
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , RecordWildCards
  , TypeApplications
  , TypeOperators
  , GeneralizedNewtypeDeriving
#-}

module BlockApps.Bloc.API.Users where

import Control.Arrow
import Control.Monad.Except
import Control.Monad.Log
import Control.Monad.Reader
import Crypto.Secp256k1
import Data.Aeson
import Data.Aeson.Casing
import Data.ByteString (ByteString)
import qualified Data.ByteString.Lazy as ByteString.Lazy
import Data.HashMap.Strict (HashMap)
import qualified Data.HashMap.Strict as HashMap
import Data.Int (Int32)
import qualified Data.Map.Strict as Map
import Data.Maybe
import Data.Monoid
import Data.Proxy
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Generic.Random.Generic
import GHC.Generics
import Numeric.Natural
import Opaleye
import Servant.API
import Servant.Client
import Servant.Docs
import Test.QuickCheck
import Web.FormUrlEncoded

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Crypto
import BlockApps.Bloc.Monad
import BlockApps.Bloc.Database.Queries
import BlockApps.Bloc.Database.Tables
import BlockApps.Ethereum
import BlockApps.Solidity
import BlockApps.Strato.Types
import BlockApps.Strato.Client

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

  getUsers = map UserName <$> blocQuery getUsersQuery

  getUsersUser (UserName name) = blocQuery $ getUsersUserQuery name

  postUsersUser (UserName name) (PostUsersUserRequest faucet pass) = do
    keyStore <- newKeyStore pass
    createdUser <- blocModify $ postUsersUserQuery name keyStore
    unless createdUser (throwError (DBError "failed to create user"))
    let
      addr = keystoreAcctAddress keyStore
    when (faucet /= 0) . void $ blocStrato (postFaucet addr)
    return addr

  postUsersSend = undefined

  postUsersContract (UserName userName) addr
    (PostUsersContractRequest src password contract args TxParams{..} value) = do
      logNotice $ "constructor arguments: " <> Text.pack (show args)
      uIds <- blocQuery $ proc () -> do
        (uId,name) <- queryTable usersTable -< ()
        restrict -< name .== constant userName
        returnA -< uId
      cryptos <- case listToMaybe uIds of
        Nothing -> throwError . DBError $
          "no user found with name: " <> userName
        Just uId -> blocQuery $ proc () -> do
          (_,salt,_,nonce,encSecKey,_,addr',uId') <-
            queryTable keyStoreTable -< ()
          restrict -< uId' .== constant (uId::Int32)
            .&& addr' .== constant addr
          returnA -< (salt,nonce,encSecKey)
      skMaybe <- case listToMaybe cryptos of
        Nothing -> throwError . DBError $
          "address does not exist for user:" <> userName
        Just (salt,nonce,encSecKey) -> return $
          decryptSecKey password salt nonce encSecKey
      case skMaybe of
        Nothing -> throwError $ UserError "incorrect password"
        Just sk -> do
          accts <- blocStrato $ getAccountsFilter
            accountsFilterParams{qaAddress = Just addr}
          nonce <- case listToMaybe accts of
            Nothing -> throwError . UserError $ "strato error: failed to find account"
            Just acct -> return . incrNonce $ accountNonce acct
          bins <- blocQuery $ proc () -> do
            (name,bin) <- joinF
              (\ (_,_,bin,_,_,_) (_,name) -> (name,bin))
              (\ (_,contractId,_,_,_,_) (cid,_) -> cid .== contractId)
              (queryTable contractsMetaDataTable)
              (queryTable contractsTable) -< ()
            restrict -< name .== constant contract
            returnA -< bin
          bin <- case listToMaybe bins of
            Nothing -> throwError $ DBError "could not find bin for contract"
            Just bin -> return (bin::ByteString)
          -- TODO: get args for constructor
          let
            unsignedTx = UnsignedTransaction
              { unsignedTransactionNonce = fromMaybe nonce txparamsNonce
              , unsignedTransactionGasPrice =
                  fromMaybe (Wei 1000000000000000000) txparamsGasPrice
              , unsignedTransactionGasLimit =
                  fromMaybe (Gas 3141592) txparamsGasLimit
              , unsignedTransactionTo = Nothing
              , unsignedTransactionValue = Wei $ fromIntegral value
              , unsignedTransactionInitOrData = undefined
              }
            (hash,CompactRecSig{..}) = signRLP sk unsignedTx
            Gas gasLimit = unsignedTransactionGasLimit unsignedTx
            Wei gasPrice = unsignedTransactionGasPrice unsignedTx
            Nonce nonce' = unsignedTransactionNonce unsignedTx
            tx = PostTransaction
              { posttransactionHash = hash
              , posttransactionGasLimit = Strung $ fromIntegral gasLimit
              , posttransactionCodeOrData = Text.decodeUtf8 bin -- TODO: add args?
              , posttransactionGasPrice = Strung $ fromIntegral gasPrice
              , posttransactionTo = Nothing
              , posttransactionFrom = addr
              , posttransactionValue = Strung value
              , posttransactionR = Hex $ fromIntegral getCompactRecSigR
              , posttransactionS = Hex $ fromIntegral getCompactRecSigS
              , posttransactionV = Hex getCompactRecSigV
              , posttransactionNonce = Strung $ fromIntegral nonce'
              }
          _ <- blocStrato $ postTx tx
          -- todo: poll strato???
          return undefined

  postUsersUploadList = undefined

  postUsersContractMethod = undefined

  -- postUsersContractMethod
  --   (UserName userName) addr
  --   (ContractName contractName) contractAddr
  --   PostUsersContractMethodRequest
  --     {
  --     } = do

      -- return PostUsersContractMethodRequest
      --   { postuserscontractmethodPassword =
      --   , postuserscontractmethodMethod =
      --   , postuserscontractmethodArgs =
      --   , postuserscontractmethodValue =
      --   }

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
  :> ReqBody '[FormUrlEncoded] PostSendParameters
  :> Post '[HTMLifiedJSON] PostTransaction
data PostSendParameters = PostSendParameters
  { sendToAddress :: Address
  , sendValue :: Natural
  , sendPassword :: Password
  } deriving (Eq, Show, Generic)
instance Arbitrary PostSendParameters where arbitrary = genericArbitrary uniform
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
  :> ReqBody '[JSON] PostUsersContractRequest
  :> Post '[HTMLifiedAddress] Address
data PostUsersContractRequest = PostUsersContractRequest
  { postuserscontractrequestSrc :: Text
  , postuserscontractrequestPassword :: Password
  , postuserscontractrequestContract :: Text
  , postuserscontractrequestArgs :: Maybe (HashMap Text Text)
  , postuserscontractrequestTxParams :: TxParams
  , postuserscontractrequestValue :: Natural
  } deriving (Eq,Show,Generic)
instance Arbitrary PostUsersContractRequest where arbitrary = genericArbitrary uniform
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
    , postuserscontractrequestTxParams = TxParams Nothing Nothing Nothing
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
  , uploadlistcontractArgs :: HashMap Text Text
  , uploadlistcontractTxParams :: TxParams
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
  , postuserscontractmethodArgs :: HashMap Text SolidityValue
  , postuserscontractmethodValue :: Natural
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
  , sendtransactionTxParams :: TxParams
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
  , methodcallArgs :: HashMap Text SolidityValue
  , methodcallValue :: Natural
  , methodcallTxParams :: TxParams
  } deriving (Eq,Show,Generic)
instance Arbitrary MethodCall where arbitrary = genericArbitrary uniform
instance ToJSON MethodCall where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON MethodCall where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
