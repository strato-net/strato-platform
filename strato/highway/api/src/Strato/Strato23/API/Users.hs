{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.API.Users where

import Data.Text
import Servant
import Strato.Strato23.API.Types

type GetUsers =
  "users"
    :> Header' '[Optional, Strict] "X-USER-ACCESS-TOKEN" Text
    :> QueryParam "address" Address
    :> QueryParam "limit" Int
    :> QueryParam "offset" Int
    :> Get '[JSON] [User]

type GetUsers' =
  "users"
    :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
    :> Header' '[Required, Strict] "X-IDENTITY-PROVIDER-ID" Text
    :> QueryParam "address" Address
    :> QueryParam "limit" Int
    :> QueryParam "offset" Int
    :> Get '[JSON] [User]
