{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeOperators #-}

module IdentityService.API
  ( IdentityServiceAPI,
    GetPingIdentity,
    PostIdentity
  )
where

import IdentityService.API.Types
import Servant.API

type GetPingIdentity = "ping" :> Get '[JSON] Int

type PostIdentity =
  "identity"
    :> ReqBody '[JSON] PostIdentityRequest
    :> Post '[JSON] PostIdentityResponse

type IdentityServiceAPI = GetPingIdentity :<|> PostIdentity