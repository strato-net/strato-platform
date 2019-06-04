{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE DeriveGeneric        #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.API.Password where

import           Data.Text
import           Servant.API

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------

type PostPassword = "password"
            :> ReqBody '[JSON] Text
            :> Post '[JSON] ()
