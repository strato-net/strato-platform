{-# LANGUAGE
    DataKinds
  , TypeOperators
#-}

module BlockApps.Bloc.API.Addresses where

import Servant.API

import BlockApps.Ethereum
import BlockApps.Bloc.API.Utils

--------------------------------------------------------------------------------
-- MonadAddresses
--------------------------------------------------------------------------------

class Monad m => MonadAddresses m where
  getAddresses :: m [Address]

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type GetAddresses = "addresses" :> Get '[HTMLifiedJSON] [Address]
