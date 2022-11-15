{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}



module Strato.VaultProxy.API.Users where


import           Data.Text
import           Servant
import           Strato.VaultProxy.API.Types


type GetUsers = "users"
              :> Header' '[Required, Strict] "X-USER-ACCESS-TOKEN" Text-- Does AUoth type have a special type?
              :> QueryParam "address" Address
              :> QueryParam "limit" Int
              :> QueryParam "offset" Int
              :> Get '[JSON] [User]
