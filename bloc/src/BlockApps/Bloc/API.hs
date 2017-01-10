{-# LANGUAGE
    DataKinds
  , TypeOperators
#-}

module BlockApps.Bloc.API (API) where

import Data.Aeson
import Data.Text
import Servant.API

import BlockApps.Strato.Types

type API =
  "users"
    :> Get '[JSON] [Value]
  :<|> "users"
    :> ReqBody '[JSON] Value
    :> Post '[JSON] Value
  :<|> "users"
    :> Capture "user" Text
    :> Get '[JSON] [Value]
  :<|> "users"
    :> Capture "user" Text
    :> Capture "address" Address
    :> "send"
    :> ReqBody '[JSON] Value
    :> Post '[JSON] Value
  :<|> "contract"
    :> Capture "contractName" Text
    :> Get '[JSON] [Value]
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
