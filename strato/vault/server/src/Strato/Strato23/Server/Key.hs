{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Strato23.Server.Key where

import           Data.ByteString (ByteString)
import           Data.Maybe                       (fromMaybe, fromJust)
import           Data.Text                        (Text)
import           Strato.Strato23.API
import           Strato.Strato23.Crypto
import           Strato.Strato23.Monad
import qualified Crypto.Saltine.Core.SecretBox  as SecretBox
import           Strato.Strato23.Database.Queries
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

getKey' :: Text -> Text -> Maybe Text -> VaultM AddressAndKey
getKey' headerUserName headerOauthProvider queryParamUserName = withSecretKey $ \key -> do
  let userName = fromMaybe headerUserName queryParamUserName
  (_ :: ByteString, nonce, encKey, _ :: Address) <- toUserError ("User " <> userName <> " doesn't exist")
                               . vaultQuery1 $ getUserKeyQuery' userName headerOauthProvider
  case decryptSecKey key nonce encKey of
    Nothing   -> vaultWrapperError IncorrectPasswordError
    Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)

getKeys' :: Text -> Text -> Maybe Text -> VaultM [AddressAndKey]
getKeys' _ _ queryParamUserName = withSecretKey $ \key -> do
  let userName = fromJust queryParamUserName
  ls :: [( ByteString, SecretBox.Nonce, ByteString,  Address)]    <-  toUserError ("User " <> userName <> " doesn't exist") . vaultQueryMany $ getUserKeyQuery userName               
  let decryptHelper nonce encKey = 
        case decryptSecKey key nonce encKey of
            Nothing   -> vaultWrapperError IncorrectPasswordError
            Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey) 
  sequence $ map (\(_, noncee, encKeyy, _ ) ->  decryptHelper noncee encKeyy) ls
  

postKey :: Text -> VaultM AddressAndKey
postKey userName = withSecretKey $ \key -> do
  keyStore@KeyStore{..} <- newKeyStore key
  created <- vaultModify $ postUserKeyQuery userName keyStore
  if not created
    then vaultWrapperError $ UserError ("User " <> userName <> " already exists")
    else case decryptSecKey key keystoreAcctNonce keystoreAcctEncSecKey of
      Nothing -> vaultWrapperError IncorrectPasswordError
      Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)


postKey' :: Text ->  Text -> VaultM AddressAndKey
postKey' userName oauthProvider = withSecretKey $ \key -> do
  keyStore@KeyStore{..} <- newKeyStore key
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
                          . vaultQuery1 $ getUserKeyQuery userName
  case decryptSecKey key nonce encKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just pKey -> return $ deriveSharedKey pKey otherPub

-- Get an ECDH shared secret from the user's private key and a supplied public key
getSharedKey' :: Text ->  Text ->  PublicKey -> VaultM SharedKey
getSharedKey' userName oauthProvider otherPub = withSecretKey $ \key -> do
  (_ :: ByteString, nonce, encKey, (_ :: Address)) <- 
                          toUserError ("User " <> userName <> " " <> oauthProvider<> " doesn't exist")
                          . vaultQuery1 $ getUserKeyQuery' userName oauthProvider
  case decryptSecKey key nonce encKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just pKey -> return $ deriveSharedKey pKey otherPub

-- Normally a key is created in vault when a user logs in for the first time (app
-- is responsible for calling the POST key). This endpoint circumvents that and
-- is to be used ONLY by the cert registration script to create keys in vault
-- before users log in for the first time (to improve user flow). The behavior 
-- is exactly as postKey' but return's address/key if user already exists (which is 
-- is purely an optimization so that if a user's key already does exist, the cert 
-- registration script can create the cert right away instead of waiting for the 
-- next run of the script)
postKeyAdmin :: Text ->  Text -> VaultM AddressAndKey
postKeyAdmin userName oauthProvider = withSecretKey $ \key -> do
  keyStore@KeyStore{..} <- newKeyStore key
  created <- vaultModify $ postUserKeyQuery' userName oauthProvider keyStore
  if not created
    then getKey' userName oauthProvider Nothing
    else case decryptSecKey key keystoreAcctNonce keystoreAcctEncSecKey of
      Nothing -> vaultWrapperError IncorrectPasswordError
      Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)