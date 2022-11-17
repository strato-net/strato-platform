{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Strato.VaultProxy.API
  ( VaultProxyAPI
  , module Strato.VaultProxy.API.Key
  , module Strato.VaultProxy.API.Password
  , module Strato.VaultProxy.API.Ping
  , module Strato.VaultProxy.API.Signature
  , module Strato.VaultProxy.API.Types
  , module Strato.VaultProxy.API.Users
  , module Strato.VaultProxy.API.Token
  , RawOauth(..)
  ) where

import           Servant
import           Strato.VaultProxy.API.Key
import           Strato.VaultProxy.API.Password
import           Strato.VaultProxy.API.Ping
import           Strato.VaultProxy.API.Signature
import           Strato.VaultProxy.API.Types
import           Strato.VaultProxy.API.Users
import           Strato.VaultProxy.API.Token


type VaultProxyAPI = GetPing
                  :<|> GetKey
                  :<|> PostKey
                  :<|> GetSharedKey
                  :<|> GetUsers
                  :<|> PostSignature
                  :<|> PostPassword
                  :<|> VerifyPassword
                  :<|> GetRawToken
                  :<|> GetCurrentUser
