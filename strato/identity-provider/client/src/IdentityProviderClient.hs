{-# LANGUAGE TypeApplications #-}

module IdentityProviderClient 
    ( getPing,
      putIdentity,
      putIdentityExternal
    ) where

import           Servant.Client
import           Data.Proxy
import           Data.Text
import           IdentityProviderAPI
import           Blockchain.Strato.Model.Address


getPing :: ClientM Int
getPing = client (Proxy @GetPingIdentity)

putIdentity :: Text -> Text -> ClientM Address
putIdentity = client (Proxy @PutIdentity)

putIdentityExternal :: Text -> ClientM Address
putIdentityExternal = client (Proxy @PutIdentityExternal)