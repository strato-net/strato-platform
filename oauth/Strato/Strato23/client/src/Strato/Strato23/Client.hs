{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE DeriveGeneric #-}

module Strato.Strato23.Client
  ( getUsers
  ) where

import           Servant.Client
import           Data.Proxy
import           Strato.Strato23.API (StratoAPI, User)

getUsers :: ClientM [User]
getUsers = client (Proxy @ StratoAPI)
