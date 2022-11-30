{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.VaultProxy.API.Token where

import           Data.Text
import           Servant

--This will get the username that is stored in the vaultproxy cache
type GetCurrentUser = "currentUser"
              :> Get '[JSON] Text

--This will get the token that is stored in the vault proxy cache (in case something is wanting to use)
type GetRawToken = "rawToken"
              :> Get '[JSON] Text