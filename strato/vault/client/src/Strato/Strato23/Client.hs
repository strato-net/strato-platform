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

getKey :: ClientEmbedOptional ClientHeaders (Maybe Text -> ClientM AddressAndKey)
getKey = client (Proxy @(GetKey '[Optional, Strict] ClientHeaders))

getKeys :: ClientEmbedOptional ClientHeaders (Maybe Text -> ClientM [AddressAndKey])
getKeys = client (Proxy @(GetKeys '[Optional, Strict] ClientHeaders))

postKey :: ClientEmbedOptional ClientHeaders (ClientM AddressAndKey)
postKey = client (Proxy @(PostKey '[Optional, Strict] ClientHeaders))

getSharedKey :: ClientEmbedOptional ClientHeaders (PublicKey -> ClientM SharedKey)
getSharedKey = client (Proxy @(GetSharedKey '[Optional, Strict] ClientHeaders))

getUsers :: ClientEmbedOptional ClientHeaders (Maybe Address -> Maybe Int -> Maybe Int -> ClientM [User]) -- External Vault
getUsers = client (Proxy @(GetUsers '[Optional, Strict] ClientHeaders))

postSignature :: ClientEmbedOptional ClientHeaders (MsgHash -> ClientM Signature)
postSignature = client (Proxy @(PostSignature '[Optional, Strict] ClientHeaders))

postPassword :: Text -> ClientM ()
postPassword = client (Proxy @PostPassword)

verifyPassword :: ClientM Bool
verifyPassword = client (Proxy @VerifyPassword)
