{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}

module BlockApps.Bloc.API.Addresses where

import           Servant.API

import           BlockApps.Bloc.API.Utils
import           BlockApps.Ethereum

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type GetAddresses = "addresses" :> Get '[HTMLifiedJSON, JSON] [Address]
