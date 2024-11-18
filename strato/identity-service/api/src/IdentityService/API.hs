{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeOperators #-}

module IdentityService.API
  ( IdentityServiceAPI,
    GetPingIdentity,
    PutIdentity
  )
where

import IdentityService.API.Types
import Servant.API

type GetPingIdentity = "ping" :> Get '[JSON] Int

type PutIdentity =
  "identity"
    :> ReqBody '[JSON] PutIdentityRequest
    :> Put '[JSON] PutIdentityResponse

type IdentityServiceAPI = GetPingIdentity :<|> PutIdentity