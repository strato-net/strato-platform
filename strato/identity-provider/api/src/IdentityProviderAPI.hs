{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}

module IdentityProviderAPI (
    IdentityProviderAPI,
    GetPingIdentity,
    PutIdentity
    ) where

import qualified  Data.Text as T
import           Servant.API
-- import           Servant.API.Header
import           Blockchain.Strato.Model.Address

type PutIdentity = "identity"
                :> Header' '[Required, Strict] "X-ACCESS-USER-TOKEN" T.Text -- pass along for vault calls
                :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" T.Text -- need for keycloak query
                :> Put '[JSON] Address --should return user address
type GetPingIdentity = "_ping" :> Get '[JSON] Int

type IdentityProviderAPI =  GetPingIdentity :<|> PutIdentity 