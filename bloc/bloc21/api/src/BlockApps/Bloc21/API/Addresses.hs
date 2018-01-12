{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}

module BlockApps.Bloc21.API.Addresses where

import           Servant.API

import           BlockApps.Ethereum

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type GetAddresses = "addresses" :> Get '[JSON] [Address]
