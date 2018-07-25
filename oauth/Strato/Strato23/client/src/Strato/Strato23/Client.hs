{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE DeriveGeneric #-}

module Strato.Strato23.Client
  ( getUsers,
    postSignature
  ) where

import           Servant.API
import           Servant.Client
import           Data.Proxy
import           Strato.Strato23.API

getUsers :: ClientM [User]
postSignature :: ClientM SignatureDetails
getUsers :<|> postSignature = client (Proxy @ StratoAPI)
