{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Strato23.API
  ( VaultWrapperAPI
  , module Strato.Strato23.API.Key
  , module Strato.Strato23.API.Password
  , module Strato.Strato23.API.Ping
  , module Strato.Strato23.API.Signature
  , module Strato.Strato23.API.Types
  , module Strato.Strato23.API.Users
  ) where

import           Servant
import           Strato.Strato23.API.Key
import           Strato.Strato23.API.Password
import           Strato.Strato23.API.Ping
import           Strato.Strato23.API.Signature
import           Strato.Strato23.API.Types
import           Strato.Strato23.API.Users


type VaultWrapperAPI = GetPing
                  :<|> GetKey
                  :<|> GetKey'
                  :<|> PostKey
                  :<|> PostKey'
                  :<|> GetSharedKey
                  :<|> GetSharedKey'
                  :<|> GetUsers
                  :<|> GetUsers'
                  :<|> PostSignature
                  :<|> PostSignature'
                  :<|> PostPassword
                  :<|> VerifyPassword
