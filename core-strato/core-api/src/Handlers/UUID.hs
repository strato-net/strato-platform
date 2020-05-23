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
import           SQLM


type API = "uuid" :> Get '[JSON] EthUniqueId

server :: ServerT API SQLM
server = getUUID

-------------------------

getUUID :: SQLM EthUniqueId
getUUID = return $ ethUniqueId ethConf
{-
getUUIDR = selectRep
             . provideJson
             . ethUniqueId
             $ ethConf
-}
