{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.UUID (
  API,
  server
  ) where

import           Servant

import           Blockchain.EthConf


type API = "uuid" :> Get '[JSON] EthUniqueId

server :: Server API
server = getUUID

-------------------------

getUUID :: Handler EthUniqueId
getUUID = return $ ethUniqueId ethConf
{-
getUUIDR = selectRep
             . provideJson
             . ethUniqueId
             $ ethConf
-}
