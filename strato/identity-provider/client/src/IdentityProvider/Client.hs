{-# LANGUAGE TypeApplications #-}

module IdentityProvider.Client 
    ( getPing,
      putIdentity,
      putIdentityExternal
    ) where

import           Servant.Client
import           Data.Proxy
import           Data.Text
import           IdentityProvider.API
import           Blockchain.Strato.Model.Address


getPing :: ClientM Int
getPing = client (Proxy @GetPingIdentity)

putIdentity :: Text -> Text -> Text -> ClientM Address
putIdentity = client (Proxy @PutIdentity)

putIdentityExternal :: Text -> ClientM Address
putIdentityExternal = client (Proxy @PutIdentityExternal)