{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Strato23.Server.Key where

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Secp256k1
import qualified Crypto.Saltine.Core.SecretBox as SecretBox
import Data.ByteString (ByteString)
import Data.Maybe (fromJust, fromMaybe)
import Data.Text (Text)
import Strato.Strato23.API
import Strato.Strato23.Crypto
import Strato.Strato23.Database.Queries
import Strato.Strato23.Monad

getKey :: Text -> Maybe Text -> VaultM AddressAndKey
getKey headerUserName queryParamUserName = withSecretKey $ \key -> do
  let userName = fromMaybe headerUserName queryParamUserName
  (_ :: ByteString, nonce, encKey, _ :: Address) <-
    toUserError ("User " <> userName <> " doesn't exist")
      . vaultQuery1
      $ getUserKeyQuery userName
  case decryptSecKey key nonce encKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)

getKey' :: Text -> Text -> Maybe Text -> VaultM AddressAndKey
getKey' headerUserName headerOauthProvider queryParamUserName = withSecretKey $ \key -> do
  let userName = fromMaybe headerUserName queryParamUserName
  (_ :: ByteString, nonce, encKey, _ :: Address) <-
    toUserError ("User " <> userName <> " doesn't exist")
      . vaultQuery1
      $ getUserKeyQuery' userName headerOauthProvider
  case decryptSecKey key nonce encKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)

getKeys' :: Text -> Text -> Maybe Text -> VaultM [AddressAndKey]
getKeys' _ _ queryParamUserName = withSecretKey $ \key -> do
  let userName = fromJust queryParamUserName
  ls :: [(ByteString, SecretBox.Nonce, ByteString, Address)] <- toUserError ("User " <> userName <> " doesn't exist") . vaultQueryMany $ getUserKeyQuery userName
  let decryptHelper nonce encKey =
        case decryptSecKey key nonce encKey of
          Nothing -> vaultWrapperError IncorrectPasswordError
          Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)
  sequence $ map (\(_, noncee, encKeyy, _) -> decryptHelper noncee encKeyy) ls

postKey :: Text -> VaultM AddressAndKey
postKey userName = withSecretKey $ \key -> do
  keyStore@KeyStore {..} <- newKeyStore key
  created <- vaultModify $ postUserKeyQuery userName keyStore
  if not created
    then vaultWrapperError $ UserError ("User " <> userName <> " already exists")
    else case decryptSecKey key keystoreAcctNonce keystoreAcctEncSecKey of
      Nothing -> vaultWrapperError IncorrectPasswordError
      Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)

postKey' :: Text -> Text -> VaultM AddressAndKey
postKey' userName oauthProvider = withSecretKey $ \key -> do
  keyStore@KeyStore {..} <- newKeyStore key
  created <- vaultModify $ postUserKeyQuery' userName oauthProvider keyStore
  if not created
    then vaultWrapperError $ UserError ("User " <> userName <> oauthProvider <> " already exists")
    else case decryptSecKey key keystoreAcctNonce keystoreAcctEncSecKey of
      Nothing -> vaultWrapperError IncorrectPasswordError
      Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)

-- Get an ECDH shared secret from the user's private key and a supplied public key
getSharedKey :: Text -> PublicKey -> VaultM SharedKey
getSharedKey userName otherPub = withSecretKey $ \key -> do
  (_ :: ByteString, nonce, encKey, (_ :: Address)) <-
    toUserError ("User " <> userName <> " doesn't exist")
      . vaultQuery1
      $ getUserKeyQuery userName
  case decryptSecKey key nonce encKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just pKey -> return $ deriveSharedKey pKey otherPub

-- Get an ECDH shared secret from the user's private key and a supplied public key
getSharedKey' :: Text -> Text -> PublicKey -> VaultM SharedKey
getSharedKey' userName oauthProvider otherPub = withSecretKey $ \key -> do
  (_ :: ByteString, nonce, encKey, (_ :: Address)) <-
    toUserError ("User " <> userName <> " " <> oauthProvider <> " doesn't exist")
      . vaultQuery1
      $ getUserKeyQuery' userName oauthProvider
  case decryptSecKey key nonce encKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just pKey -> return $ deriveSharedKey pKey otherPub
