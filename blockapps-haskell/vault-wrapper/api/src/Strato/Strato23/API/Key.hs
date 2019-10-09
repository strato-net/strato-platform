{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.API.Key where

import           Data.Text
import           Servant.API
import           Strato.Strato23.API.Types

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type GetKey = "key"
            :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
            :> QueryParam "username" Text
            :> Get '[JSON] StatusAndAddress

type PostKey = "key"
            :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
            :> Post '[JSON] StatusAndAddress
