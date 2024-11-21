{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeOperators #-}

module IdentityService.API
  ( IdentityServiceAPI,
    GetPingIdentity,
    PutIdentity,
    GetUsernameAvailable
  )
where

import IdentityService.API.Types
import Servant.API

type GetPingIdentity = "ping" :> Get '[JSON] Int

type PutIdentity =
  "identity"
    :> ReqBody '[JSON] PutIdentityRequest
    :> Put '[JSON] PutIdentityResponse

type GetUsernameAvailable = "username-available" 
      :> ReqBody '[JSON] GetUsernameAvailableRequest
      :> Get '[JSON] Bool

type IdentityServiceAPI = GetPingIdentity :<|> PutIdentity :<|> GetUsernameAvailable