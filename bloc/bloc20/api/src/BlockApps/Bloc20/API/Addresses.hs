{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}

module BlockApps.Bloc20.API.Addresses where

import           Servant.API

import           BlockApps.Bloc20.API.Utils
import           BlockApps.Ethereum

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type GetAddresses = "addresses" :> Get '[HTMLifiedJSON, JSON] [Address]
