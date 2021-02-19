{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.UUID (
  API,
  server
  ) where

import           Servant
import           Servant.Swagger.Tags

import           Blockchain.EthConf

type API = Tags "Strato"
           :> Summary "A UUID for the version of Strato being used."
--           :> Description "" :>
           :> "uuid" :> Get '[JSON] EthUniqueId

server :: Applicative m => ServerT API m
server = getUUID

-------------------------

getUUID :: Applicative m => m EthUniqueId
getUUID = pure $ ethUniqueId ethConf
{-
getUUIDR = selectRep
             . provideJson
             . ethUniqueId
             $ ethConf
-}
