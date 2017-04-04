{-# LANGUAGE
    DataKinds
  , DeriveGeneric
  , TypeOperators
#-}

module BlockApps.Cirrus.API where

import Data.Aeson (Value)
import Data.Text (Text)
import Servant.API

import BlockApps.Solidity.Xabi

type API =
  "cirrus"
    :> "contract"
    :> ReqBody '[JSON] ContractDetails
    :> Post '[JSON] NoContent
  :<|> "cirrus"
    :> "search"
    :> Get '[JSON] Value
  :<|> "cirrus"
    :> "search"
    :> Capture "ContractName" Text
    :> Get '[JSON] ContractDetails
