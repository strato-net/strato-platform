{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}

module IdentityProviderAPI (
    IdentityProviderAPI,
    GetPingIdentity,
    PutIdentity,
    PutIdentityExternal
    ) where

import qualified  Data.Text as T
import            Servant.API
import            Blockchain.Strato.Model.Address

type GetPingIdentity = "_ping" :> Get '[JSON] Int

type PutIdentity = "identity" 
                :> Header' '[Required, Strict] "X-ACCESS-USER-TOKEN" T.Text -- pass along for vault calls
                :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" T.Text -- need for keycloak query
                :> Put '[JSON] Address --should return user address

type PutIdentityExternal = "identity" -- only to be used for external api client bindings
                :> Header' '[Required, Strict]  "Authorization" T.Text
                :> Put '[JSON] Address 


type IdentityProviderAPI =  GetPingIdentity :<|> PutIdentity :<|> PutIdentityExternal