{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module Strato.Strato23.Server.Signature where

import           Crypto.Secp256k1
import           Data.Text                        (Text)
import           Strato.Strato23.Monad
import           Strato.Strato23.API.Signature
import           Strato.Strato23.API.Types
import           Strato.Strato23.Crypto
import           Strato.Strato23.Database.Queries (getUserKeyQuery)
import           Strato.Strato23.Server.Key       (postKey)
import           Strato.Strato23.Server.Utils     (word256ToByteString)

postSignature :: Text -> Text -> UserData -> VaultM SignatureDetails
postSignature userName userId (UserData (Hex msgHash)) = do
  mpk <- vaultTransaction
        . vaultQueryMaybe
        $ getUserKeyQuery userName
  (salt,nonce,pKey) <- case mpk of
    Just pk -> return pk
    Nothing -> do
      _ <- postKey userName userId
      vaultTransaction
        . vaultQuery1
        $ getUserKeyQuery userName
  case decryptSecKey (textPassword userId) salt nonce pKey of
    Nothing -> vaultWrapperError $ UserError "Incorrect password"
    Just prvKey -> case msg (word256ToByteString msgHash) of
      Nothing -> vaultWrapperError $ AnError "Message was not 32 bytes long"
      Just msg' -> do
        let sig = exportCompactRecSig $ signRecMsg prvKey msg'
        return $ SignatureDetails
                  (Hex $ getCompactRecSigR sig)
                  (Hex $ getCompactRecSigS sig)
                  (Hex $ getCompactRecSigV sig)
