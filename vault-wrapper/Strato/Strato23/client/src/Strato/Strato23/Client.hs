{-# LANGUAGE TypeApplications #-}

module Strato.Strato23.Client
  ( postSignature,
    getPing
  ) where

import           Servant.Client
import           Data.Proxy
import           Data.Text
import           Strato.Strato23.API

postSignature :: Maybe Text -> ClientM SignatureDetails
postSignature = client (Proxy @ PostSignature)

getPing :: ClientM String
getPing = client (Proxy @ GetPing)
