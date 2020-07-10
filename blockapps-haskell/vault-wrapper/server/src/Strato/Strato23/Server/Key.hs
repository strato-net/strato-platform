{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Strato23.Server.Key where

import           Data.Maybe                       (fromMaybe, isJust)
import           Data.Text                        (Text)

import           Strato.Strato23.API
import           Strato.Strato23.Crypto
import           Strato.Strato23.Monad
import           Strato.Strato23.Database.Queries
import           Blockchain.Strato.Model.Address
import           Blockchain.ECDSA


getKey :: Text -> Maybe Text -> VaultM AddressAndKey
getKey headerUserName queryParamUserName = withPassword $ \pw -> do
  let userName = fromMaybe headerUserName queryParamUserName
  (salt, nonce, encKey, addr , pub) <- toUserError ("User " <> userName <> " doesn't exist")
                               . vaultQuery1 $ getUserKeyQuery userName
  if isJust queryParamUserName          -- decrypt and derive the address if query param
    then return $ AddressAndKey addr pub -- not specified, to guarantee correctness
    else case decryptSecKey pw salt nonce encKey of
      Nothing -> vaultWrapperError IncorrectPasswordError
      Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) pub

postKey :: Text -> VaultM AddressAndKey
postKey userName = withPassword $ \pw -> do
  keyStore@KeyStore{..} <- newKeyStore pw
  created <- vaultModify $ postUserKeyQuery userName keyStore
  if not created
    then vaultWrapperError $ UserError ("User " <> userName <> " already exists")
    else case decryptSecKey pw keystoreSalt keystoreAcctNonce keystoreAcctEncSecKey of
      Nothing -> vaultWrapperError IncorrectPasswordError
      Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) keystoreAcctPubKey


-- Get an ECDH shared secret from the user's private key and a supplied public key
getSharedKey :: Text -> PublicKey -> VaultM SharedKey
getSharedKey userName otherPub = withPassword $ \pw -> do
  (salt, nonce, encKey, (_ :: Address), (_ :: PublicKey)) <- 
                          toUserError ("User " <> userName <> " doesn't exist")
                          . vaultQuery1 $ getUserKeyQuery userName
  case decryptSecKey pw salt nonce encKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just pKey -> return $ deriveSharedKey pKey otherPub
