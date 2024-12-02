{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeOperators #-}

module IdentityService.API
  ( IdentityServiceAPI,
    GetPingIdentity,
    PutIdentity,
    PostUsernameAvailable
  )
where

import IdentityService.API.Types
import Servant.API

type GetPingIdentity = "ping" :> Get '[JSON] Int

type PutIdentity =
  "identity"
    :> ReqBody '[JSON] PutIdentityRequest
    :> Put '[JSON] PutIdentityResponse

type PostUsernameAvailable = "username-available" 
      :> ReqBody '[JSON] PostUsernameAvailableRequest
      :> Post '[JSON] OryMessages

type IdentityServiceAPI = GetPingIdentity :<|> PutIdentity :<|> PostUsernameAvailable