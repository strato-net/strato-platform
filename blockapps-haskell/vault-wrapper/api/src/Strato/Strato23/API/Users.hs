{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}



module Strato.Strato23.API.Users where


import           Data.Text
import           Servant
import           Strato.Strato23.API.Types


type GetUsers = "users"
              :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
              :> QueryParam "address" Address
              :> QueryParam "limit" Int
              :> QueryParam "offset" Int
              :> Get '[JSON] [User]
