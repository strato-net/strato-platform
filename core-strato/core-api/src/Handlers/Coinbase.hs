{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Coinbase (
  API,
  server
  ) where

import           Data.Aeson
import           Servant

import           Blockchain.EthConf

type API = "coinbase" :> Get '[JSON] Value

server :: Server API
server = getCoinbase

-------------------------

getCoinbase :: Handler Value
getCoinbase = do
  return $ object ["coinbase" .= coinbaseAddress (quarryConfig ethConf)]
