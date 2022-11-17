{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.VaultProxy.API.Password where

import           Data.Text
import           Servant.API

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------

type PostPassword = "password"
            :> ReqBody '[JSON] Text
            :> Post '[JSON] ()

type VerifyPassword = "verify-password" 
            :> Get '[JSON] Bool
