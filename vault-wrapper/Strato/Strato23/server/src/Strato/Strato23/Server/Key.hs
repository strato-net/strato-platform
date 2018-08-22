{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module Strato.Strato23.Server.Key where

import           Crypto.Secp256k1
import qualified Data.ByteString                  as BS
import           Data.Text                        (Text)
import           Strato.Strato23.API
import           Strato.Strato23.Crypto
import           Strato.Strato23.Monad
import           Strato.Strato23.Database.Queries (postUserKeyQuery)

deriveAddress :: SecKey -> Address
deriveAddress = keccak256Address . BS.drop 1 . exportPubKey False . derivePubKey

postKey :: Text -> Text -> VaultM StatusAndAddress
postKey userName userId = do
  let pw = textPassword userId
  keyStore@KeyStore{..} <- newKeyStore pw
  _ <- vaultTransaction
     . toUserError ("User " <> userName <> " already exists")
     . vaultModify
     $ postUserKeyQuery userName keyStore
  case decryptSecKey pw keystoreSalt keystoreAcctNonce keystoreAcctEncSecKey of
    Nothing -> vaultWrapperError $ AnError "Error occurred while creating keystore"
    Just pKey -> return . StatusAndAddress $ deriveAddress pKey
