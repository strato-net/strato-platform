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

getKey :: ClientEmbed ExternalHeaders (Maybe Text -> ClientM AddressAndKey)
getKey = client (Proxy @(GetKey '[Optional, Strict] ExternalHeaders))

getKeys :: ClientEmbed ExternalHeaders (Maybe Text -> ClientM [AddressAndKey])
getKeys = client (Proxy @(GetKeys '[Optional, Strict] ExternalHeaders))

postKey :: ClientEmbed ExternalHeaders (ClientM AddressAndKey)
postKey = client (Proxy @(PostKey '[Optional, Strict] ExternalHeaders))

getSharedKey :: ClientEmbed ExternalHeaders (PublicKey -> ClientM SharedKey)
getSharedKey = client (Proxy @(GetSharedKey '[Optional, Strict] ExternalHeaders))

getUsers :: ClientEmbed ExternalHeaders (Maybe Address -> Maybe Int -> Maybe Int -> ClientM [User]) -- External Vault
getUsers = client (Proxy @(GetUsers '[Optional, Strict] ExternalHeaders))

postSignature :: ClientEmbed ExternalHeaders (MsgHash -> ClientM Signature)
postSignature = client (Proxy @(PostSignature '[Optional, Strict] ExternalHeaders))

postPassword :: Text -> ClientM ()
postPassword = client (Proxy @PostPassword)

verifyPassword :: ClientM Bool
verifyPassword = client (Proxy @VerifyPassword)
