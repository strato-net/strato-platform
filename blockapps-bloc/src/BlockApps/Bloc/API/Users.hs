{-# LANGUAGE
    DataKinds
  , DeriveAnyClass
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , TypeOperators
#-}

module BlockApps.Bloc.API.Users where

import Data.Aeson
import Data.Aeson.Casing
import Data.HashMap.Strict (HashMap)
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import Numeric.Natural
import Servant.API
-- import Servant.Client
import Servant.Docs
import Test.QuickCheck
import Web.FormUrlEncoded

import BlockApps.Bloc.API.Utils
import BlockApps.Data
import BlockApps.Strato.Types (PostTransaction)

type GetUsers = "users"
  :> Get '[HTMLifiedJSON] [UserName]

type PostUser = "users"
  :> Capture "user" UserName
  :> ReqBody '[FormUrlEncoded] PostUserParameters
  :> Post '[HTMLifiedAddress] Address

type GetUserAddresses = "users"
  :> Capture "user" UserName
  :> Get '[HTMLifiedJSON] [Address]

type PostSend = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "send"
  :> ReqBody '[FormUrlEncoded] PostSendParameters
  :> Post '[HTMLifiedJSON] PostTransaction

type PostContract = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "contract"
  :> ReqBody '[FormUrlEncoded] SrcPassword
  :> Post '[JSON] Keccak256

type PostUploadList = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "uploadList"
  :> ReqBody '[JSON] UploadList
  :> Post '[JSON] UnstructuredJSON

-- This should return the return value from the method call
type PostContractMethod = "users"
  :> Capture "user" UserName
  :> Capture "userAddress" Address
  :> "contract"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> "call"
  :> Post '[JSON] NoContent

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

data PostUserParameters = PostUserParameters
  { userFaucet :: Int
  , userPassword :: Text
  } deriving (Eq, Show, Generic)
instance ToForm PostUserParameters where
  toForm = genericToForm (FormOptions (camelCase . drop 4))
instance FromForm PostUserParameters where
  fromForm = genericFromForm (FormOptions (camelCase . drop 4))
instance ToSample PostUserParameters where
  toSamples _ = singleSample PostUserParameters
    { userFaucet = 1
    , userPassword = "securePassword"
    }

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
