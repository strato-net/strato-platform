{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Coinbase
  ( API
  , coinbaseClient
  , server
  ) where

import           Data.Aeson
import           Servant
import           Servant.Client

import           Blockchain.EthConf

type API = "coinbase" :> Get '[JSON] Value

coinbaseClient :: ClientM Value
coinbaseClient = client (Proxy @API)

server :: Server API
server = getCoinbase

-------------------------

getCoinbase :: Handler Value
getCoinbase = do
  return $ object ["coinbase" .= coinbaseAddress (quarryConfig ethConf)]
