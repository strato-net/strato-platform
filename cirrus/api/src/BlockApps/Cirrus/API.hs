{-# LANGUAGE
    DataKinds
  , DeriveGeneric
  , TypeOperators
#-}

module BlockApps.Cirrus.API where

import Data.Text (Text)
import Servant.API

import BlockApps.Solidity.Xabi

type API =
  "contract"
    :> ReqBody '[JSON] ContractDetails
    :> Post '[JSON] NoContent
  :<|> "search"
    :> Get '[JSON] [ContractDetails]
  :<|> "search"
    :> Capture "ContractName" Text
    :> Get '[JSON] ContractDetails
