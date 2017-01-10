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
  ( API
  , PostUserParameters (..)
  , PostSendParameters (..)
  ) where

import Data.Aeson
import qualified Data.ByteString.Lazy.Char8 as LBS
import Data.List
import Data.Maybe
import Data.Text (Text)
import GHC.Generics
import qualified Network.HTTP.Media as M
import Numeric.Natural
import Servant.API
import Text.Read
import Web.FormUrlEncoded

import BlockApps.Strato.Types

type API =
  "users"
    :> Get '[HTMLifiedJSON] [Text]
  :<|> "users"
    :> Capture "user" Text
    :> ReqBody '[FormUrlEncoded] PostUserParameters
    :> Post '[HTMLifiedRead] Address
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
    :> Get '[JSON] Value
  :<|> "contracts"
    :> Capture "contractName" Text
    :> Get '[OctetStream] Value
  :<|> "users"
    :> Capture "user" Text
    :> Capture "address" Address
    :> "contract"
    :> ReqBody '[JSON] Value
    :> Post '[JSON] Value
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
    :> Get '[JSON] [Value]

-- hack because endpoints are returning stringified json as text/html
data HTMLifiedJSON
instance Accept HTMLifiedJSON where
  contentType _ = "text" M.// "html" M./: ("charset", "utf-8")
instance FromJSON x => MimeUnrender HTMLifiedJSON x where
  mimeUnrender _ = eitherDecode

data HTMLifiedRead
instance Accept HTMLifiedRead where
  contentType _ = "text" M.// "html" M./: ("charset", "utf-8")
instance Read x => MimeUnrender HTMLifiedRead x where
  mimeUnrender _ = readEither . LBS.unpack

-- hack because endpoints are returning stringified json
-- as application/octet-stream
instance FromJSON x => MimeUnrender OctetStream x where
  mimeUnrender _ = eitherDecode

data PostUserParameters = PostUserParameters
  { user_faucet :: Int
  , user_password :: Text
  } deriving (Eq, Show, Generic)
instance ToForm PostUserParameters where
  toForm = genericToForm
    defaultFormOptions{ fieldLabelModifier = idOrStripPrefix "user_" }

data PostSendParameters = PostSendParameters
  { send_toAddress :: Address
  , send_value :: Natural
  , send_password :: Text
  } deriving (Eq, Show, Generic)
instance ToForm PostSendParameters where
  toForm = genericToForm
    defaultFormOptions{ fieldLabelModifier = idOrStripPrefix "send_" }

-- helpers
idOrStripPrefix :: String -> String -> String
idOrStripPrefix prefix string = fromMaybe string $ stripPrefix prefix string
