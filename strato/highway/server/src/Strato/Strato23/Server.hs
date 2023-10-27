{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Strato23.Server where

import Control.Lens ((&), (.~), (?~))
import Data.Proxy
import Data.Swagger as Swag
import Servant
import Servant.Swagger (toSwagger)
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

serveVaultWrapper :: VaultWrapperEnv -> Server VaultWrapperAPI
serveVaultWrapper env = hoistServer serverProxy (enterVaultWrapper env) vaultWrapper

serverProxy :: Proxy VaultWrapperAPI
serverProxy = Proxy

vaultWrapperSwagger :: Swagger
vaultWrapperSwagger =
  toSwagger (Proxy @VaultWrapperAPI)
    & info . title .~ "Vault Wrapper API"
    & info . Swag.version .~ "2.3"
    & info . description ?~ "This is the V2.3 API for Vault Wrapper"
    & basePath ?~ "/strato/v2.3"

type VaultWrapperDocsAPI = "swagger.json" :> Get '[JSON] Swagger
