{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Strato23.API
  ( VaultWrapperAPI
  , module Strato.Strato23.API.Key
  , module Strato.Strato23.API.Password
  , module Strato.Strato23.API.Ping
  , module Strato.Strato23.API.Signature
  , module Strato.Strato23.API.Types
  , GetUsers
  ) where

import           Data.Text
import           Servant
import           Strato.Strato23.API.Key
import           Strato.Strato23.API.Password
import           Strato.Strato23.API.Ping
import           Strato.Strato23.API.Signature
import           Strato.Strato23.API.Types

type GetUsers = "users"
              :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
              :> QueryParam "address" Address
              :> QueryParam "limit" Int
              :> QueryParam "offset" Int
              :> Get '[JSON] [User]

type VaultWrapperAPI = GetPing
                  :<|> GetKey
                  :<|> GetUsers
                  :<|> PostKey
                  :<|> PostSignature
                  :<|> PostPassword
                  :<|> VerifyPassword
