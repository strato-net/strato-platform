{-# LANGUAGE DataKinds           #-}
{-# LANGUAGE PolyKinds           #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE TypeFamilies        #-}
{-# LANGUAGE TypeOperators       #-}

module Strato.Strato23.Client
  ( getPing
  , getKey
  , getKeys
  , postKey
  , getSharedKey
  , getUsers
  , postSignature
  , postPassword
  , verifyPassword
  ) where

import           Servant.API
import           Servant.Client
import           Data.Proxy
import           Data.Text
import           Strato.Strato23.API

getPing :: ClientM Version
getPing = client (Proxy @GetPing)

getKey :: Maybe Text -> Maybe Text -> ClientM AddressAndKey
getKey = client (Proxy @(GetKey '[Optional, Strict] ExternalHeaders))

getKeys :: Maybe Text -> Maybe Text -> ClientM [AddressAndKey]
getKeys = client (Proxy @(GetKeys '[Optional, Strict] ExternalHeaders))

postKey :: Maybe Text -> ClientM AddressAndKey
postKey = client (Proxy @(PostKey '[Optional, Strict] ExternalHeaders))

getSharedKey :: Maybe Text -> PublicKey -> ClientM SharedKey
getSharedKey = client (Proxy @(GetSharedKey '[Optional, Strict] ExternalHeaders))

getUsers :: Maybe Text -> Maybe Address -> Maybe Int -> Maybe Int -> ClientM [User] -- External Vault
getUsers = client (Proxy @(GetUsers '[Optional, Strict] ExternalHeaders))

postSignature :: Maybe Text -> MsgHash -> ClientM Signature
postSignature = client (Proxy @(PostSignature '[Optional, Strict] ExternalHeaders))

postPassword :: Text -> ClientM ()
postPassword = client (Proxy @PostPassword)

verifyPassword :: ClientM Bool
verifyPassword = client (Proxy @VerifyPassword)
