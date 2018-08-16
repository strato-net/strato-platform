{-# LANGUAGE TypeOperators #-}

module Strato.Strato23.API
  ( VaultWrapperAPI
  , module Strato.Strato23.API.Key
  , module Strato.Strato23.API.Ping
  , module Strato.Strato23.API.Signature
  , module Strato.Strato23.API.Types
  ) where

import           Servant
import           Strato.Strato23.API.Key
import           Strato.Strato23.API.Ping
import           Strato.Strato23.API.Signature
import           Strato.Strato23.API.Types

type VaultWrapperAPI = GetPing
                  :<|> PostKey
                  :<|> PostSignature

