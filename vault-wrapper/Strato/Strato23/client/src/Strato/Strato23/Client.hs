{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DeriveGeneric #-}

module Strato.Strato23.Client
  ( postSignature,
    getPing
  ) where

import           Servant.Client
import           Data.Proxy
import           Strato.Strato23.API

postSignature :: ClientM SignatureDetails
postSignature = client (Proxy @ PostSignature)

getPing :: ClientM String
getPing = client (Proxy @ GetPing)
