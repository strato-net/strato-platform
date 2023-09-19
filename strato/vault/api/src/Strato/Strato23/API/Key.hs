{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.API.Key where

import Data.Text
import Servant.API
import Strato.Strato23.API.Types

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type GetKey =
  "key"
    :> Header' '[Optional, Strict] "X-USER-ACCESS-TOKEN" Text
    :> QueryParam "username" Text
    :> Get '[JSON] AddressAndKey

type PostKey =
  "key"
    :> Header' '[Optional, Strict] "X-USER-ACCESS-TOKEN" Text
    :> Post '[JSON] AddressAndKey

type GetSharedKey =
  "sharedkey"
    :> Header' '[Optional, Strict] "X-USER-ACCESS-TOKEN" Text
    :> ReqBody '[JSON] PublicKey
    :> Get '[JSON] SharedKey

--------------------------------------------------------------------------------
type GetKey' =
  "key"
    :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
    :> Header' '[Required, Strict] "X-IDENTITY-PROVIDER-ID" Text
    :> QueryParam "username" Text
    :> Get '[JSON] AddressAndKey

type GetKeys' =
  "key"
    :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
    :> Header' '[Required, Strict] "X-IDENTITY-PROVIDER-ID" Text
    :> QueryParam "username" Text
    :> Get '[JSON] [AddressAndKey]

type PostKey' =
  "key"
    :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
    :> Header' '[Required, Strict] "X-IDENTITY-PROVIDER-ID" Text
    :> Post '[JSON] AddressAndKey

type GetSharedKey' =
  "sharedkey"
    :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
    :> Header' '[Required, Strict] "X-IDENTITY-PROVIDER-ID" Text
    :> ReqBody '[JSON] PublicKey
    :> Get '[JSON] SharedKey
