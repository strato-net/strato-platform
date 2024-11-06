{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeOperators #-}

module IdentityProvider.API
  ( IdentityProviderAPI,
    IdentityInternalHeaders,
    GetPingIdentity,
    PutIdentity,
  )
where

import API.Parametric
import Blockchain.Strato.Model.Address
import Data.Text (Text)
import Servant.API

type GetPingIdentity = "ping" :> Get '[JSON] Int

type PutIdentity r hs =
  "identity"
    :> ApiEmbed r hs
    -- :> Header' '[Required, Strict] "X-USER-ACCESS-TOKEN" Text -- pass along for vault calls
    -- :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text -- could probs delete now?
    -- :> Header' '[Required, Strict] "X-USER-COMMON-NAME" Text
    -- :> Header' '[Optional, Strict] "X-USER-EMAIL" Text
    (  QueryParam "company" Text
    :> QueryParam "subscribe" Bool
    :> Put '[JSON] Address --should return user address
    )

type IdentityInternalHeaders = '["X-USER-ACCESS-TOKEN", "X-USER-UNIQUE-NAME", "X-USER-COMMON-NAME"]
type IdentityProviderAPI' r hs = GetPingIdentity :<|> PutIdentity r hs
type IdentityProviderAPI = IdentityProviderAPI' '[Required, Strict] IdentityInternalHeaders