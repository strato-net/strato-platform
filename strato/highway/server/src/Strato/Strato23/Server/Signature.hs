{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Strato23.Server.Signature where

--(Text, append)
import Blockchain.Strato.Model.Secp256k1
import Control.Monad.Reader (asks)
import qualified Data.ByteString as B
import qualified Data.Cache as Cache
import Data.Text
import Strato.Strato23.API.Types
import Strato.Strato23.Crypto
import Strato.Strato23.Database.Queries (getUserKeyQuery, getUserKeyQuery')
import Strato.Strato23.Monad
import UnliftIO

postSignature :: Text -> MsgHash -> VaultM Signature
postSignature userName (MsgHash msgBS) = do
  cache <- asks keyStoreCache
  cachedPk <- liftIO $ Cache.lookup cache userName
  (_, nonce, pKey, _) <- case cachedPk of
    Just (KeyStore a b c d) -> pure (a, b, c, d)
    Nothing -> do
      mpk <-
        vaultTransaction
          . vaultQueryMaybe
          $ getUserKeyQuery userName
      (a, b, c, d) <- case mpk of
        Just pk -> return pk
        Nothing -> vaultWrapperError $ UserError ("User " <> userName <> " doesn't exist")
      liftIO . Cache.insert cache userName $ KeyStore a b c d
      pure (a, b, c, d)
  withSecretKey $ \key -> case decryptSecKey key nonce pKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just prvKey
      | B.length msgBS == 32 -> return $ signMsg prvKey msgBS
      | otherwise -> vaultWrapperError $ AnError "Message was not 32 bytes long"

postSignature' :: Text -> Text -> MsgHash -> VaultM Signature
postSignature' userName oauthProvider (MsgHash msgBS) = do
  cache <- asks keyStoreCache
  cachedPk <- liftIO $ Cache.lookup cache (append userName oauthProvider)
  (_, nonce, pKey, _) <- case cachedPk of
    Just (KeyStore a b c d) -> pure (a, b, c, d)
    Nothing -> do
      mpk <-
        vaultTransaction
          . vaultQueryMaybe
          $ getUserKeyQuery' userName oauthProvider
      (a, b, c, d) <- case mpk of
        Just pk -> return pk
        Nothing -> vaultWrapperError $ UserError ("User " <> userName <> " doesn't exist")
      liftIO . Cache.insert cache (append userName oauthProvider) $ KeyStore a b c d
      pure (a, b, c, d)
  withSecretKey $ \key -> case decryptSecKey key nonce pKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just prvKey
      | B.length msgBS == 32 -> return $ signMsg prvKey msgBS
      | otherwise -> vaultWrapperError $ AnError "Message was not 32 bytes long"
