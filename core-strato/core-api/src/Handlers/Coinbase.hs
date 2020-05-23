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
import           SQLM

type API = "coinbase" :> Get '[JSON] Value

coinbaseClient :: ClientM Value
coinbaseClient = client (Proxy @API)

server :: ServerT API SQLM
server = getCoinbase

-------------------------

getCoinbase :: SQLM Value
getCoinbase = do
  return $ object ["coinbase" .= coinbaseAddress (quarryConfig ethConf)]
