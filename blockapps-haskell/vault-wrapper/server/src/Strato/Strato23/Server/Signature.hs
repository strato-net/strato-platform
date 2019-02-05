{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Strato23.Server.Signature where

import           BlockApps.Ethereum
import           Crypto.HaskoinShim
import           Data.Text                        (Text)
import           Strato.Strato23.Monad
import           Strato.Strato23.API.Types
import           Strato.Strato23.Crypto
import           Strato.Strato23.Database.Queries (getUserKeyQuery)
import           Strato.Strato23.Server.Key       (postKey)

postSignature :: Text -> UserData -> VaultM SignatureDetails
postSignature userName (UserData (Hex msgHash)) = do
  mpk <- vaultTransaction
        . vaultQueryMaybe
        $ getUserKeyQuery userName
  (salt,nonce,pKey,(_ :: Address)) <- case mpk of
    Just pk -> return pk
    Nothing -> do
      _ <- postKey userName
      vaultTransaction
        . vaultQuery1
        $ getUserKeyQuery userName
  withPassword $ \pw -> case decryptSecKey pw salt nonce pKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just prvKey -> case msg msgHash of
      Nothing -> vaultWrapperError $ AnError "Message was not 32 bytes long"
      Just msg' -> do
        let sig = exportCompactRecSig $ signRecMsg prvKey msg'
        return $ SignatureDetails
                  (Hex . alsoRemoveThisOne $ getCompactRecSigR sig)
                  (Hex . alsoRemoveThisOne $ getCompactRecSigS sig)
                  (Hex $ 0x1b + getCompactRecSigV sig)
