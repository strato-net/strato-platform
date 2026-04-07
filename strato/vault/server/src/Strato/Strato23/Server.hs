{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Strato23.Server where

import Control.Lens ((&), (.~), (?~))
import Data.Proxy
import Data.OpenApi as Swag
import Servant
import Servant.OpenApi (toOpenApi)
import Strato.Strato23.API
import Strato.Strato23.Monad
import Strato.Strato23.Server.Key
import Strato.Strato23.Server.Password
import Strato.Strato23.Server.Ping
import Strato.Strato23.Server.Signature
import Strato.Strato23.Server.User

vaultWrapper :: ServerT VaultWrapperAPI VaultM
vaultWrapper =
  getPing
    :<|> getKey'
    :<|> getKeys'
    :<|> postKey'
    :<|> getSharedKey'
    :<|> getUsers'
    :<|> postSignature'
    :<|> postPassword
    :<|> verifyPassword

serveVaultWrapper :: VaultWrapperEnv -> Servant.Server VaultWrapperAPI
serveVaultWrapper env = hoistServer serverProxy (enterVaultWrapper env) vaultWrapper

serverProxy :: Proxy VaultWrapperAPI
serverProxy = Proxy

vaultWrapperSwagger :: OpenApi
vaultWrapperSwagger =
  toOpenApi (Proxy @VaultWrapperAPI)
    & info . title .~ "Vault Wrapper API"
    & info . Swag.version .~ "2.3"
    & info . description ?~ "This is the V2.3 API for Vault Wrapper"

type VaultWrapperDocsAPI = "openapi.json" :> Get '[JSON] OpenApi
