{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.UUID
  ( API,
    server,
  )
where

import Blockchain.EthConf
import Servant

type API = "uuid" :> Get '[JSON] EthUniqueId

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
