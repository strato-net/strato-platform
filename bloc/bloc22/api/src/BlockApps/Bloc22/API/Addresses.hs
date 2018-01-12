{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}

module BlockApps.Bloc22.API.Addresses where

import           Servant.API

import           BlockApps.Ethereum

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type GetAddresses = "addresses" :> Get '[JSON] [Address]
