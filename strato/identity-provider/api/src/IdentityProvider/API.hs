{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}

module IdentityProvider.API (
    IdentityProviderAPI,
    GetPingIdentity,
    PutIdentity,
    PutIdentityExternal
    ) where

import            Data.Text (Text)
import            Servant.API
import            Blockchain.Strato.Model.Address

type GetPingIdentity = "ping" :> Get '[JSON] Int

type PutIdentity = "identity" 
                :> Header' '[Required, Strict] "X-USER-ACCESS-TOKEN" Text -- pass along for vault calls
                :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text -- need for keycloak query
                :> Header' '[Required, Strict] "X-IDENTITY-PROVIDER-ID" Text
                :> Header' '[Required, Strict] "X-USER-COMMON-NAME" Text
                :> QueryParam "company" Text 
                :> Put '[JSON] Address --should return user address

type PutIdentityExternal = "identity" -- only to be used for external api client bindings
                :> Header' '[Required, Strict]  "Authorization" Text
                :> Put '[JSON] Address 


type IdentityProviderAPI =  GetPingIdentity :<|> PutIdentity :<|> PutIdentityExternal