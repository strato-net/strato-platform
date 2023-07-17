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
type GetKey r hs = "key"
                :> ApiEmbed r hs
                 ( QueryParam "username" Text
                :> Get '[JSON] AddressAndKey
                 )

type GetKeys r hs = "key"
                 :> ApiEmbed r hs
                  ( QueryParam "username" Text
                 :> Get '[JSON] [AddressAndKey]
                  )

type PostKey r hs = "key"
                 :> ApiEmbed r hs
                   ( Post '[JSON] AddressAndKey )

type GetSharedKey r hs = "sharedkey"
                      :> ApiEmbed r hs
                        ( ReqBody '[JSON] PublicKey
                      :> Get '[JSON] SharedKey
                        )
