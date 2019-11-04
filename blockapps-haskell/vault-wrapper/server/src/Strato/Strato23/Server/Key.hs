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

getKey :: Text -> Maybe Text -> VaultM StatusAndAddress
getKey headerUserName queryParamUserName = withPassword $ \pw -> do
  let userName = fromMaybe headerUserName queryParamUserName
  (salt, nonce, encKey, addr) <- toCouldNotFind ("User " <> userName <> " doesn't exist")
                               . vaultQuery1 $ getUserKeyQuery userName
  if isJust queryParamUserName          -- decrypt and derive the address if query param
    then return $ StatusAndAddress addr -- not specified, to guarantee correctness
    else case decryptSecKey pw salt nonce encKey of
      Nothing -> vaultWrapperError IncorrectPasswordError
      Just pKey -> return . StatusAndAddress $ deriveAddress pKey

postKey :: Text -> VaultM StatusAndAddress
postKey userName = withPassword $ \pw -> do
  keyStore@KeyStore{..} <- newKeyStore pw
  created <- vaultModify $ postUserKeyQuery userName keyStore
  if not created
    then vaultWrapperError $ UserError ("User " <> userName <> " already exists")
    else case decryptSecKey pw keystoreSalt keystoreAcctNonce keystoreAcctEncSecKey of
      Nothing -> vaultWrapperError IncorrectPasswordError
      Just pKey -> return . StatusAndAddress $ deriveAddress pKey
