{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeOperators #-}

module IdentityProvider.API
  ( IdentityProviderAPI,
    GetPingIdentity,
    PutIdentity,
    PutIdentityExternal,
  )
where

import Blockchain.Strato.Model.Address
import Data.Text (Text)
import Servant.API

type GetPingIdentity = "ping" :> Get '[JSON] Int

type PutIdentity =
  "identity"
    :> Header' '[Required, Strict] "X-USER-ACCESS-TOKEN" Text -- pass along for vault calls
    :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text -- need for keycloak query
    :> Header' '[Required, Strict] "X-IDENTITY-PROVIDER-ID" Text
    :> Header' '[Required, Strict] "X-USER-COMMON-NAME" Text
    :> Header' '[Optional, Strict] "X-USER-EMAIL" Text
    :> QueryParam "company" Text
    :> QueryParam "subscribe" Bool
    :> Put '[JSON] Address --should return user address

type PutIdentityExternal =
  "identity" -- only to be used for external api client bindings
    :> Header' '[Required, Strict] "Authorization" Text
    :> QueryParam "subscribe" Bool
    :> Put '[JSON] Address

type IdentityProviderAPI = GetPingIdentity :<|> PutIdentity :<|> PutIdentityExternal
