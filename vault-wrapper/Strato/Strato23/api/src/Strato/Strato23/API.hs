{-# LANGUAGE TypeOperators #-}

module Strato.Strato23.API
  ( VaultWrapperAPI
  , module Strato.Strato23.API.Ping
  , module Strato.Strato23.API.Signature
  ) where

import           Servant
import           Strato.Strato23.API.Ping
import           Strato.Strato23.API.Signature

type VaultWrapperAPI = GetPing
  :<|> PostSignature

