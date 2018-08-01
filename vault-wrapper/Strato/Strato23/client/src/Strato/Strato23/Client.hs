{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DeriveGeneric #-}

module Strato.Strato23.Client
  ( postSignature,
    getPing
  ) where

import           Servant.API
import           Servant.Client
import           Data.Proxy
import           Strato.Strato23.API

postSignature :: Maybe [Char] -> ClientM SignatureDetails
getPing :: ClientM String
getPing :<|> postSignature = client (Proxy @ StratoAPI)
