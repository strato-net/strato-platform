{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Strato23.Server.Key where

import           Data.ByteString (ByteString)
import           Data.Maybe                       (fromMaybe, isJust)
import           Data.Text                        (Text)
import           Strato.Strato23.API
import           Strato.Strato23.Crypto
import           Strato.Strato23.Monad
import           Strato.Strato23.Database.Queries

getKey :: Text -> Maybe Text -> VaultM AddressAndKey
getKey headerUserName queryParamUserName = withSecretKey $ \key -> do
  let userName = fromMaybe headerUserName queryParamUserName
  (_ :: ByteString, nonce, encKey, addr, pub) <- toUserError ("User " <> userName <> " doesn't exist")
                               . vaultQuery1 $ getUserKeyQuery userName
  if isJust queryParamUserName          -- decrypt and derive the address if query param
    then return $ AddressAndKey addr pub -- not specified, to guarantee correctness
    else case decryptSecKey key nonce encKey of
      Nothing -> vaultWrapperError IncorrectPasswordError
      Just pKey -> return $ AddressAndKey (deriveAddress pKey) (derivePublicKey pKey)
      -- TODO: maybe we can remove addr and pub columns since we just derive them everytime

postKey :: Text -> VaultM AddressAndKey
postKey userName = withSecretKey $ \key -> do
  keyStore@KeyStore{..} <- newKeyStore key
  created <- vaultModify $ postUserKeyQuery userName keyStore
  if not created
    then vaultWrapperError $ UserError ("User " <> userName <> " already exists")
    else case decryptSecKey key keystoreAcctNonce keystoreAcctEncSecKey of
      Nothing -> vaultWrapperError IncorrectPasswordError
      Just pKey -> return $ AddressAndKey (deriveAddress pKey) keystoreAcctPubKey
