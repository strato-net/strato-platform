{-# LANGUAGE TypeApplications #-}

module IdentityService.Client
  ( getPing,
    putIdentity
  )
where

import Data.Proxy
import IdentityService.API
import IdentityService.API.Types
import Servant.Client

getPing :: ClientM Int
getPing = client (Proxy @GetPingIdentity)

putIdentity :: PutIdentityRequest -> ClientM PutIdentityResponse
putIdentity = client (Proxy @PutIdentity)
