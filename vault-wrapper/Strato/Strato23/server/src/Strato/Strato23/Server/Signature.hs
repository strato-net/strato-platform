{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module Strato.Strato23.Server.Signature where

import           Crypto.Secp256k1
import           Data.Monoid                      ((<>))
import qualified Data.Text                        as T
import           Strato.Strato23.Monad
import           Strato.Strato23.API.Signature
import           Strato.Strato23.API.Types
import           Strato.Strato23.Database.Queries (getUserKeyQuery)
import           Strato.Strato23.Server.Utils     (word256ToByteString)

signatureDetails :: Maybe T.Text -> UserData -> VaultM SignatureDetails
signatureDetails mUserId (UserData (Hex msgHash)) = case mUserId of
  Nothing -> vaultWrapperError $ UserError "No user ID provided"
  Just userId -> do
    mPrvKey <- vaultTransaction
             . toUserError ("User " <> userId <> " not found")
             . vaultQuery1
             $ getUserKeyQuery userId
    case secKey mPrvKey of
      Nothing -> vaultWrapperError $ AnError "coult not decode private key"
      Just prvKey -> case msg (word256ToByteString msgHash) of
        Nothing -> vaultWrapperError $ AnError "message was not 32 bytes long"
        Just msg' -> do
          let sig = exportCompactRecSig $ signRecMsg prvKey msg'
          return $ SignatureDetails
                    (Hex $ getCompactRecSigR sig)
                    (Hex $ getCompactRecSigS sig)
                    (Hex $ getCompactRecSigV sig)
