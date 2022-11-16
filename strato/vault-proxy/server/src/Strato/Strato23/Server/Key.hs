{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.VaultProxy.Server.Key where

import           Data.ByteString (ByteString)
import           Data.Maybe                       (fromMaybe)
import           Data.Text                        (Text)

import           Strato.VaultProxy.API
import           Strato.VaultProxy.Crypto
import           Strato.VaultProxy.Monad
import           Strato.VaultProxy.Database.Queries
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Secp256k1


getKey :: Text -> Maybe Text -> VaultM AddressAndKey
getKey headerUserName queryParamUserName = withSecretKey $ \key -> do
  let userName = fromMaybe headerUserName queryParamUserName
  (_ :: ByteString, nonce, encKey, _ :: Address) <- toUserError ("User " <> userName <> " doesn't exist")
                               . vaultQuery1 $ getUserKeyQuery userName
  case decryptSecKey key nonce encKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)

postKey :: Text -> VaultM AddressAndKey
postKey userName = withSecretKey $ \key -> do
  keyStore@KeyStore{..} <- newKeyStore key
  created <- vaultModify $ postUserKeyQuery userName keyStore
  if not created
    then vaultWrapperError $ UserError ("User " <> userName <> " already exists")
    else case decryptSecKey key keystoreAcctNonce keystoreAcctEncSecKey of
      Nothing -> vaultWrapperError IncorrectPasswordError
      Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)


-- Get an ECDH shared secret from the user's private key and a supplied public key
getSharedKey :: Text -> PublicKey -> VaultM SharedKey
getSharedKey userName otherPub = withSecretKey $ \key -> do
  (_ :: ByteString, nonce, encKey, (_ :: Address)) <- 
                          toUserError ("User " <> userName <> " doesn't exist")
                          . vaultQuery1 $ getUserKeyQuery userName
  case decryptSecKey key nonce encKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just pKey -> return $ deriveSharedKey pKey otherPub
