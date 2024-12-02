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

getKey :: ClientEmbed InternalHeaders (Maybe Text -> ClientM AddressAndKey)
getKey = client (Proxy @(GetKey '[Optional, Strict] InternalHeaders))

getKeys :: ClientEmbed InternalHeaders (Maybe Text -> ClientM [AddressAndKey])
getKeys = client (Proxy @(GetKeys '[Optional, Strict] InternalHeaders))

postKey :: ClientEmbed InternalHeaders (ClientM AddressAndKey)
postKey = client (Proxy @(PostKey '[Optional, Strict] InternalHeaders))

getSharedKey :: ClientEmbed InternalHeaders (PublicKey -> ClientM SharedKey)
getSharedKey = client (Proxy @(GetSharedKey '[Optional, Strict] InternalHeaders))

getUsers :: ClientEmbed InternalHeaders (Maybe Address -> Maybe Int -> Maybe Int -> ClientM [User]) -- Internal Vault
getUsers = client (Proxy @(GetUsers '[Optional, Strict] InternalHeaders))

postSignature :: ClientEmbed InternalHeaders (MsgHash -> ClientM Signature)
postSignature = client (Proxy @(PostSignature '[Optional, Strict] InternalHeaders))

postPassword :: Text -> ClientM ()
postPassword = client (Proxy @PostPassword)

verifyPassword :: ClientM Bool
verifyPassword = client (Proxy @VerifyPassword)
