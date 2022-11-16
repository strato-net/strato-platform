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
            :> Get '[JSON] AddressAndKey

type PostKey = "key"
            :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
            :> Post '[JSON] AddressAndKey

type GetSharedKey = "sharedkey"
                 :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
                 :> ReqBody '[JSON] PublicKey
                 :> Get '[JSON] SharedKey


--------------------------------------------------------------------------------
type GetKey' = "key"
            :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME"  Text
            :> Header' '[Required, Strict] "X-OAUTH-PROVIDER"    Text
            :> QueryParam "username" Text
            :> Get '[JSON] AddressAndKey

type GetKeys' = "key"
            :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME"  Text
            :> Header' '[Required, Strict] "X-OAUTH-PROVIDER"    Text
            :> QueryParam "username" Text
            :> Get '[JSON] [AddressAndKey]

type PostKey' = "key"
            :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
            :> Header' '[Required, Strict] "X-OAUTH-PROVIDER"    Text
            :> Post '[JSON] AddressAndKey

type GetSharedKey' = "sharedkey"
                 :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
                 :> Header' '[Required, Strict] "X-OAUTH-PROVIDER"    Text
                 :> ReqBody '[JSON] PublicKey
                 :> Get '[JSON] SharedKey