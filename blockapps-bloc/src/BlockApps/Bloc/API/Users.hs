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

-- import Control.Monad
import Control.Monad.Except
import Control.Monad.Reader
import qualified Crypto.KDF.BCrypt as BCrypt
import qualified Crypto.KDF.Scrypt as Scrypt
import Crypto.Random.Entropy
import Crypto.Secp256k1
import qualified Crypto.Saltine.Core.SecretBox as SecretBox
import qualified Crypto.Saltine.Internal.ByteSizes as Saltine
import qualified Crypto.Saltine.Class as Saltine
import Data.Aeson
import Data.Aeson.Casing
import Data.ByteString (ByteString)
import qualified Data.ByteString.Lazy as ByteString.Lazy
import Data.Functor.Contravariant
import Data.HashMap.Strict (HashMap)
import Data.Maybe
import Data.Monoid
import Data.Proxy
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Generic.Random.Generic
import GHC.Generics
import qualified Hasql.Decoders as Decoders
import qualified Hasql.Encoders as Encoders
import Hasql.Query
import Hasql.Session
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

  getUsers = do
    conn <- asks dbConnection
    let
      encoder = Encoders.unit
      decoder = Decoders.rowsList (Decoders.value (UserName <$> Decoders.text))
      sqlText = "SELECT name FROM users;"
      sqlStatement = statement sqlText encoder decoder False
    usersEither <- liftIO $ run (query () sqlStatement) conn
    case usersEither of
      Left err -> throwError $ DBError err
      Right users -> return users

  getUsersUser (UserName name) = do
    conn <- asks dbConnection
    let
      encoder = Encoders.value Encoders.text
      decoder = Decoders.rowsList (Decoders.value addressDecoder)
      sqlText =
        "SELECT K.address FROM users U JOIN keystore K\
        \ ON K.user_id = U.id WHERE U.name = $1;"
      sqlStatement = statement sqlText encoder decoder False
    addressesEither <- liftIO $ run (query name sqlStatement) conn
    case addressesEither of
      Left err -> throwError $ DBError err
      Right addresses -> return addresses

  postUsersUser (UserName name) (PostUsersUserRequest faucet pw) = do
    let
      encoder = contramap fst (Encoders.value Encoders.text)
        <> contramap snd paramsKeyStore
      decoder = Decoders.rowsAffected
      sqlText =
        "WITH userid AS (\
        \ SELECT id FROM users WHERE name = $1)\
        \ , newUserId AS (\
        \ INSERT INTO users (name) SELECT $1 WHERE NOT EXISTS (SELECT id FROM users WHERE name = $1)\
        \ RETURNING id)\
        \ INSERT INTO keystore (salt,password_hash,nonce,enc_sec_key,pub_key,address,user_id)\
        \ SELECT $2, $3, $4, $5, $6, $7, uid.id FROM (SELECT id FROM userid UNION SELECT id FROM newUserId) uid;"
      sqlStatement = statement sqlText encoder decoder False
    conn <- asks dbConnection
    keyStore <- liftIO . newKeyStore . Password $ Text.encodeUtf8 pw
    mgr <- asks httpManager
    url <- asks urlStrato
    resultEither <- liftIO $
      run (query (name, keyStore) sqlStatement) conn
    case resultEither of
      Left err -> throwError $ DBError err
      Right _ -> do
        let
          addr = keystoreAcctAddress keyStore
        liftIO . when (faucet == 1) $
          void $ runClientM (postFaucet addr) (ClientEnv mgr url)
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
data PostUsersUploadListResponse = PostUsersUploadListResponse
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
instance Arbitrary TxParams where arbitrary = genericArbitrary
instance ToJSON TxParams where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON TxParams where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

newtype Password = Password ByteString

data KeyStore = KeyStore
  { keystoreSalt :: ByteString
  , keystorePasswordHash :: ByteString
  , keystoreAcctNonce :: ByteString
  , keystoreAcctEncSecKey :: ByteString
  , keystorePubKey :: ByteString
  , keystoreAcctAddress :: Address
  } deriving (Eq,Show,Generic)

newKeyStore :: Password -> IO KeyStore
newKeyStore (Password pw) = do
  -- BCrypt for password validation
  -- Scrypt for password derived encryption key
  -- NaCl SecretBox (XSalsa20 Poly1305) for encryption
  -- Secp256k1 for ethereum account creation
  salt <- getEntropy 16
  acctNonce <- SecretBox.newNonce
  acctSk <- newSecKey
  pwHash <- BCrypt.hashPassword 6 pw
  let
    scryptParams = Scrypt.Parameters
      { Scrypt.n = 16384
      , Scrypt.r = 8
      , Scrypt.p = 1
      , Scrypt.outputLength = Saltine.secretBoxKey
      }
    err = error "could not decode encryption key"
    encKey = fromMaybe err . Saltine.decode $
      Scrypt.generate scryptParams pw salt
    encAcctSk = SecretBox.secretbox encKey acctNonce (getSecKey acctSk)
    acctPk = derivePubKey acctSk
    acctAddr = deriveAddress acctPk
  return KeyStore
    { keystoreSalt = salt
    , keystorePasswordHash = pwHash
    , keystoreAcctNonce = Saltine.encode acctNonce
    , keystoreAcctEncSecKey = encAcctSk
    , keystorePubKey = exportPubKey False acctPk
    , keystoreAcctAddress = acctAddr
    }
paramsKeyStore :: Encoders.Params KeyStore
paramsKeyStore = mconcat
  [ contramap keystoreSalt (Encoders.value Encoders.bytea)
  , contramap keystorePasswordHash (Encoders.value Encoders.bytea)
  , contramap keystoreAcctNonce (Encoders.value Encoders.bytea)
  , contramap keystoreAcctEncSecKey (Encoders.value Encoders.bytea)
  , contramap keystorePubKey (Encoders.value Encoders.bytea)
  , contramap keystoreAcctAddress (Encoders.value addressEncoder)
  ]
