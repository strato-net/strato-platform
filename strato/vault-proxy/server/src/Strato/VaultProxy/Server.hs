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
import           Strato.VaultProxy.Server.Token
import           Strato.VaultProxy.Server.User
import           Strato.VaultProxy.DataTypes
import           Strato.VaultProxy.RawOauth

vaultProxy :: ServerT VaultProxyAPI VaultProxyM
vaultProxy = getPing
          :<|> getKey
          :<|> postKey
          :<|> getSharedKey
          :<|> getUsers
          :<|> postSignature
          :<|> postPassword
          :<|> verifyPassword
          :<|> getRawToken
          :<|> getCurrentUser

serveVaultProxy :: VaultConnection -> Server VaultProxyAPI
serveVaultProxy env = hoistServer serverProxy (enterVaultProxy env) vaultProxy

serverProxy :: Proxy VaultProxyAPI
serverProxy = Proxy

vaultProxySwagger :: Swagger
vaultProxySwagger = toSwagger (Proxy @ VaultProxyAPI)
    & info.title   .~ "Vault Proxy API"
    & info.version .~ "2.3"
    & info.description ?~ "This is the V2.3 API for Vault Proxy"
    & basePath ?~ "/vaultProxy"

type VaultProxyDocsAPI = "swagger.json" :> Get '[JSON] Swagger
