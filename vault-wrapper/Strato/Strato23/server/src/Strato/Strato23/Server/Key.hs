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

getKey :: Text -> Text -> Maybe Text -> VaultM StatusAndAddress
getKey headerUserName userId queryParamUserName = do
  let userName = fromMaybe headerUserName queryParamUserName
  (salt, nonce, encKey, addr) <- toUserError ("User " <> userName <> " doesn't exist")
                               . vaultQuery1 $ getUserKeyQuery userName
  if isJust queryParamUserName          -- decrypt and derive the address if query param
    then return $ StatusAndAddress addr -- not specified, to guarantee correctness
    else case decryptSecKey (textPassword userId) salt nonce encKey of
      Nothing -> vaultWrapperError $ UserError "X-USER-ID does not match entry for X-USER-UNIQUE-NAME"
      Just pKey -> return . StatusAndAddress $ deriveAddress pKey

postKey :: Text -> Text -> VaultM StatusAndAddress
postKey userName userId = do
  let pw = textPassword userId
  keyStore@KeyStore{..} <- newKeyStore pw
  created <- vaultModify $ postUserKeyQuery userName keyStore
  if not created
    then vaultWrapperError $ UserError ("User " <> userName <> " already exists")
    else case decryptSecKey pw keystoreSalt keystoreAcctNonce keystoreAcctEncSecKey of
      Nothing -> vaultWrapperError $ AnError "Error occurred while creating keystore"
      Just pKey -> return . StatusAndAddress $ deriveAddress pKey
