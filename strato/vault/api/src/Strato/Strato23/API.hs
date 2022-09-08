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
  , module Strato.Strato23.API.X509
  ) where

import           Servant
import           Strato.Strato23.API.Key
import           Strato.Strato23.API.Password
import           Strato.Strato23.API.Ping
import           Strato.Strato23.API.Signature
import           Strato.Strato23.API.Types
import           Strato.Strato23.API.Users
import           Strato.Strato23.API.X509


type VaultWrapperAPI = GetPing
                  :<|> GetKey
                  :<|> PostKey
                  :<|> GetSharedKey
                  :<|> GetUsers
                  :<|> PostSignature
                  :<|> PostPassword
                  :<|> VerifyPassword
                  :<|> CreateCertificate
