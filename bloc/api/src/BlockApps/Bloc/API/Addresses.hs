{-# LANGUAGE
    DataKinds
  , TypeOperators
#-}

module BlockApps.Bloc.API.Addresses where

import Servant.API

import BlockApps.Ethereum
import BlockApps.Bloc.API.Utils

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type GetAddresses = "addresses" :> Get '[HTMLifiedJSON, JSON] [Address]
