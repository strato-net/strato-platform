{-# LANGUAGE TypeApplications #-}

module Strato.Strato23.Client
  ( getPing,
    getKey,
    postKey,
    getSharedKey,
    getUsers,
    postSignature,
    postPassword,
    verifyPassword,
  )
where

import Data.Proxy
import Data.Text
import Servant.Client
import Strato.Strato23.API

getPing :: ClientM Version
getPing = client (Proxy @GetPing)

getKey :: Maybe Text -> Maybe Text -> ClientM AddressAndKey
getKey = client (Proxy @GetKey)

postKey :: Maybe Text -> ClientM AddressAndKey
postKey = client (Proxy @PostKey)

getSharedKey :: Maybe Text -> PublicKey -> ClientM SharedKey
getSharedKey = client (Proxy @GetSharedKey)

getUsers :: Maybe Text -> Maybe Address -> Maybe Int -> Maybe Int -> ClientM [User]
getUsers = client (Proxy @GetUsers)

postSignature :: Maybe Text -> MsgHash -> ClientM Signature
postSignature = client (Proxy @PostSignature)

postPassword :: Text -> ClientM ()
postPassword = client (Proxy @PostPassword)

verifyPassword :: ClientM Bool
verifyPassword = client (Proxy @VerifyPassword)
