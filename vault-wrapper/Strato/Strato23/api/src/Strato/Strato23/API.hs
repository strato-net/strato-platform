{-# OPTIONS_GHC -fno-warn-unused-binds #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DataKinds  #-}
{-# LANGUAGE TypeApplications #-}

module Strato.Strato23.API
  ( StratoAPI
  , module Strato.Strato23.API.Ping
  , module Strato.Strato23.API.Signature
  ) where

import           Servant
import           Strato.Strato23.API.Ping
import           Strato.Strato23.API.Signature

type StratoAPI = GetPing
  :<|> PostSignature

