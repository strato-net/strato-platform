{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Strato23.Server.Signature where

import           Control.Monad.Reader                  (asks)
import qualified Data.ByteString                       as B
import qualified Data.Cache                            as Cache
import           Data.Text                             (Text)
import           Blockchain.Strato.Model.Secp256k1
import           Strato.Strato23.Monad
import           Strato.Strato23.API.Types
import           Strato.Strato23.Crypto
import           Strato.Strato23.Database.Queries      (getUserKeyQuery)
import           Strato.Strato23.Server.Key            (postKey)
import           UnliftIO



postSignature :: Text -> MsgHash -> VaultM Signature
postSignature userName (MsgHash msgBS) = do
  cache <- asks keyStoreCache
  cachedPk <- liftIO $ Cache.lookup cache userName
  (salt,nonce,pKey,_,_) <- case cachedPk of
    Just (KeyStore a b c d e) -> pure (a,b,c,d,e)
    Nothing -> do
      mpk <- vaultTransaction
           . vaultQueryMaybe
           $ getUserKeyQuery userName
      (a,b,c,d,e) <- case mpk of
        Just pk -> return pk
        Nothing -> do
          _ <- postKey userName
          vaultTransaction
            . vaultQuery1
            $ getUserKeyQuery userName
      liftIO . Cache.insert cache userName $ KeyStore a b c d e
      pure (a,b,c,d,e)
  withPassword $ \pw -> case decryptSecKey pw salt nonce pKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just prvKey 
      | B.length msgBS == 32 -> return $ signMsg prvKey msgBS 
      | otherwise -> vaultWrapperError $ AnError "Message was not 32 bytes long"
