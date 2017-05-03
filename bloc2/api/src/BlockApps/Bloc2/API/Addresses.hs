{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}

module BlockApps.Bloc2.API.Addresses where

import           Servant.API

import           BlockApps.Bloc2.API.Utils
import           BlockApps.Ethereum

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type GetAddresses = "addresses" :> Get '[HTMLifiedJSON, JSON] [Address]
