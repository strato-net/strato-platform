{-# LANGUAGE TypeApplications #-}

module IdentityProvider.Client
  ( getPing,
    putIdentity,
    putIdentityExternal,
  )
where

import Blockchain.Strato.Model.Address
import Data.Proxy
import Data.Text
import IdentityProvider.API
import Servant.Client

getPing :: ClientM Int
getPing = client (Proxy @GetPingIdentity)

putIdentity :: Text -> Text -> Text -> Text -> Maybe Text -> Maybe Text -> Maybe Bool -> ClientM Address
putIdentity = client (Proxy @PutIdentity)

putIdentityExternal :: Text -> Maybe Bool -> ClientM Address
putIdentityExternal = client (Proxy @PutIdentityExternal)
