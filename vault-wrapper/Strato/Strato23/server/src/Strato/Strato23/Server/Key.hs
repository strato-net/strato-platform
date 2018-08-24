{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module Strato.Strato23.Server.Key where

import           Crypto.Secp256k1
import qualified Data.ByteString                  as BS
import           Data.Text                        (Text)
import           Strato.Strato23.API
import           Strato.Strato23.Crypto
import           Strato.Strato23.Monad
import           Strato.Strato23.Database.Queries

deriveAddress :: SecKey -> Address
deriveAddress = keccak256Address . BS.drop 1 . exportPubKey False . derivePubKey

getKey :: Text -> Text -> VaultM StatusAndAddress
getKey userName userId = do
  (salt, nonce, encKey) <- toUserError ("User " <> userName <> " doesn't exist")
                         . vaultQuery1 $ getUserKeyQuery userName
  case decryptSecKey (textPassword userId) salt nonce encKey of
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
