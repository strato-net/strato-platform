{-# LANGUAGE TypeApplications #-}

module IdentityService.Client
  ( getPing,
    postIdentity
  )
where

import Data.Proxy
import IdentityService.API
import IdentityService.API.Types
import Servant.Client

getPing :: ClientM Int
getPing = client (Proxy @GetPingIdentity)

postIdentity :: PostIdentityRequest -> ClientM PostIdentityResponse
postIdentity = client (Proxy @PostIdentity)
