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
  ) where

import Data.Aeson
import qualified Data.Aeson.Types as JSON
import qualified Data.ByteString.Lazy.Char8 as LBS
import Data.List
import Data.Maybe
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import qualified Network.HTTP.Media as M
import Numeric.Natural
import Servant.API
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Web.FormUrlEncoded

import BlockApps.Strato.Types

type BlocAPI =
  "users"
    :> Get '[HTMLifiedJSON] [Text]
  :<|> "users"
    :> Capture "user" Text
    :> ReqBody '[FormUrlEncoded] PostUserParameters
    :> Post '[HTMLifiedAddress] Address
  :<|> "users"
    :> Capture "user" Text
    :> Get '[HTMLifiedJSON] [Address]
  :<|> "users"
    :> Capture "user" Text
    :> Capture "address" Address
    :> "send"
    :> ReqBody '[FormUrlEncoded] PostSendParameters
    :> Post '[HTMLifiedJSON] PostTransaction
  :<|> "contracts"
    :> Get '[JSON] Contracts
  :<|> "contracts"
    :> Capture "contractName" Text
    :> Get '[OctetStream] [Text]
  :<|> "users"
    :> Capture "user" Text
    :> Capture "address" Address
    :> "contract"
    :> ReqBody '[FormUrlEncoded] SrcPassword
    :> Post '[JSON] Keccak256
  :<|> "contracts"
    :> Capture "contractName" Text
    :> Capture "contractAddress" Address
    :> Get '[JSON] Value
  :<|> "contracts"
    :> Capture "contractName" Text
    :> Capture "contractAddress" Address
    :> "state"
    :> Get '[JSON] Value -- change to HTML
  :<|> "users"
    :> Capture "user" Text
    :> Capture "userAddress" Address
    :> "contract"
    :> Capture "contractName" Text
    :> Capture "contractAddress" Address
    :> "call"
    :> Post '[JSON] NoContent
  :<|> "addresses"
    :> Get '[HTMLifiedJSON] [Address]

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
  toJSON = genericToJSON defaultOptions{JSON.fieldLabelModifier = const "Address"}
instance FromJSON Contracts where
  parseJSON = genericParseJSON defaultOptions{JSON.fieldLabelModifier = const "Address"}
instance Arbitrary Contracts where arbitrary = genericArbitrary

data SrcPassword = SrcPassword
  { src :: Text
  , password :: Text
  } deriving (Eq,Show,Generic)
instance ToForm SrcPassword
instance FromForm SrcPassword

-- helpers
idOrStripPrefix :: String -> String -> String
idOrStripPrefix prefix string = fromMaybe string $ stripPrefix prefix string
