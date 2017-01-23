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

module BlockApps.Bloc.API
  ( BlocAPI
  , PostUserParameters (..)
  , PostSendParameters (..)
  , Contract (..)
  , Contracts (..)
  , SrcPassword (..)
  , UserName (..)
  , ContractName (..)
  ) where

import Data.Aeson
import qualified Data.Aeson.Types as JSON (fieldLabelModifier)
import qualified Data.ByteString.Lazy.Char8 as LBS
import Data.List
import Data.Maybe
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
  "users"
    :> Get '[HTMLifiedJSON] [UserName]
  :<|> "users"
    :> Capture "user" UserName
    :> ReqBody '[FormUrlEncoded] PostUserParameters
    :> Post '[HTMLifiedAddress] Address
  :<|> "users"
    :> Capture "user" UserName
    :> Get '[HTMLifiedJSON] [Address]
  :<|> "users"
    :> Capture "user" UserName
    :> Capture "address" Address
    :> "send"
    :> ReqBody '[FormUrlEncoded] PostSendParameters
    :> Post '[HTMLifiedJSON] PostTransaction
  :<|> "contracts"
    :> Get '[JSON] Contracts
  :<|> "contracts"
    :> Capture "contractName" ContractName
    :> Get '[OctetStream] [Address]
  :<|> "users"
    :> Capture "user" UserName
    :> Capture "address" Address
    :> "contract"
    :> ReqBody '[FormUrlEncoded] SrcPassword
    :> Post '[JSON] Keccak256
  -- :<|> "contracts"
  --   :> Capture "contractName" ContractName
  --   :> Capture "contractAddress" Address
  --   :> Get '[JSON] Value
  -- :<|> "contracts"
  --   :> Capture "contractName" ContractName
  --   :> Capture "contractAddress" Address
  --   :> "state"
  --   :> Get '[JSON] Value -- change to HTML
  :<|> "users"
    :> Capture "user" UserName
    :> Capture "userAddress" Address
    :> "contract"
    :> Capture "contractName" ContractName
    :> Capture "contractAddress" Address
    :> "call"
    :> Post '[JSON] NoContent
  :<|> "addresses"
    :> Get '[HTMLifiedJSON] [Address]

newtype UserName = UserName Text
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

data PostUserParameters = PostUserParameters
  { user_faucet :: Int
  , user_password :: Text
  } deriving (Eq, Show, Generic)
instance ToForm PostUserParameters where
  toForm = genericToForm
    defaultFormOptions{ fieldLabelModifier = idOrStripPrefix "user_" }
instance FromForm PostUserParameters where
  fromForm = genericFromForm
    defaultFormOptions{ fieldLabelModifier = idOrStripPrefix "user_" }
instance ToSample PostUserParameters where
  toSamples _ = singleSample PostUserParameters
    { user_faucet = 1
    , user_password = "securePassword"
    }

data PostSendParameters = PostSendParameters
  { send_toAddress :: Address
  , send_value :: Natural
  , send_password :: Text
  } deriving (Eq, Show, Generic)
instance ToForm PostSendParameters where
  toForm = genericToForm
    defaultFormOptions{ fieldLabelModifier = idOrStripPrefix "send_" }
instance FromForm PostSendParameters where
  fromForm = genericFromForm
    defaultFormOptions{ fieldLabelModifier = idOrStripPrefix "send_" }
instance ToSample PostSendParameters where
  toSamples _ = singleSample PostSendParameters
    { send_toAddress = Address 0xdeadbeef
    , send_value = 10
    , send_password = "securePassword"
    }

data Contract = Contract
  { createdAt :: Integer
  , address :: Text
  } deriving (Eq, Show, Generic)
instance ToJSON Contract
instance FromJSON Contract
instance Arbitrary Contract where arbitrary = genericArbitrary

data Contracts = Contracts
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

-- helpers
idOrStripPrefix :: String -> String -> String
idOrStripPrefix prefix string = fromMaybe string $ stripPrefix prefix string
