{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module Strato.VaultProxy.Server where

import           Control.Lens             ((&), (.~), (?~))
import           Data.Proxy
import           Data.Swagger
import           Servant
import           Servant.Swagger

import           Strato.VaultProxy.API
import           Strato.VaultProxy.Monad
import           Strato.VaultProxy.Server.Key
import           Strato.VaultProxy.Server.Password
import           Strato.VaultProxy.Server.Ping
import           Strato.VaultProxy.Server.Signature
import           Strato.VaultProxy.Server.User

vaultWrapper :: ServerT VaultWrapperAPI VaultM
vaultWrapper = getPing
          :<|> getKey
          :<|> postKey
          :<|> getSharedKey
          :<|> getUsers
          :<|> postSignature
          :<|> postPassword
          :<|> verifyPassword

serveVaultWrapper :: VaultWrapperEnv -> Server VaultWrapperAPI
serveVaultWrapper env = hoistServer serverProxy (enterVaultWrapper env) vaultWrapper

serverProxy :: Proxy VaultWrapperAPI
serverProxy = Proxy

vaultWrapperSwagger :: Swagger
vaultWrapperSwagger = toSwagger (Proxy @ VaultWrapperAPI)
    & info.title   .~ "Vault Wrapper API"
    & info.version .~ "2.3"
    & info.description ?~ "This is the V2.3 API for Vault Wrapper"
    & basePath ?~ "/strato/v2.3"

type VaultWrapperDocsAPI = "swagger.json" :> Get '[JSON] Swagger
