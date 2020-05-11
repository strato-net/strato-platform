{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Strato23.Server.Signature where

import           BlockApps.Ethereum
import           Control.Monad.Reader             (asks)
import           Crypto.HaskoinShim
import qualified Data.Cache                       as Cache
import           Data.Text                        (Text)
import           Strato.Strato23.Monad
import           Strato.Strato23.API.Types
import           Strato.Strato23.Crypto
import           Strato.Strato23.Database.Queries (getUserKeyQuery)
import           Strato.Strato23.Server.Key       (postKey)
import           UnliftIO

postSignature :: Text -> UserData -> VaultM SignatureDetails
postSignature userName (UserData (Hex msgHash)) = do
  cache <- asks keyStoreCache
  cachedPk <- liftIO $ Cache.lookup cache userName
  (salt,nonce,pKey,_) <- case cachedPk of
    Just (KeyStore a b c d) -> pure (a,b,c,d)
    Nothing -> do
      mpk <- vaultTransaction
           . vaultQueryMaybe
           $ getUserKeyQuery userName
      (a,b,c,d) <- case mpk of
        Just pk -> return pk
        Nothing -> do
          _ <- postKey userName
          vaultTransaction
            . vaultQuery1
            $ getUserKeyQuery userName
      liftIO . Cache.insert cache userName $ KeyStore a b c d
      pure (a,b,c,d)
  withPassword $ \pw -> case decryptSecKey pw salt nonce pKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just prvKey -> case msg msgHash of
      Nothing -> vaultWrapperError $ AnError "Message was not 32 bytes long"
      Just msg' -> do
        let sig = exportCompactRecSig $ signRecMsg prvKey msg'
        return $ SignatureDetails
                  (Hex $ getCompactRecSigR sig)
                  (Hex $ getCompactRecSigS sig)
                  (Hex $ 0x1b + getCompactRecSigV sig)
