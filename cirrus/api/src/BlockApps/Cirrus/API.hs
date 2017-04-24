{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}

module BlockApps.Cirrus.API where

import           Data.Aeson
import           Data.Text               (Text)
import           Servant.API

import           BlockApps.Solidity.Xabi

type API =
  "contract/" -- why do I need a slash?
    :> ReqBody '[JSON] ContractDetails
    :> Post '[JSON] NoContent
  :<|> "search"
    :> Get '[JSON] Value
  :<|> "search"
    :> Capture "ContractName" Text
    :> Get '[JSON] Value
