{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.VaultProxy.Server.Signature where

-- import           Control.Monad.Reader                  (asks)
-- import qualified Data.ByteString                       as B
-- import qualified Data.Cache                            as Cache
import           Data.Text                             (Text)
import           Blockchain.Strato.Model.Secp256k1
import           Strato.VaultProxy.Monad
import           Strato.VaultProxy.API.Types
-- import           Strato.VaultProxy.Crypto
-- import           UnliftIO


--bounce the request to the vault
postSignature :: Text -> MsgHash -> VaultProxyM Signature
-- postSignature userName (MsgHash msgBS) = pure undefined
postSignature = pure undefined
  -- do
  -- cache <- asks keyStoreCache
  -- cachedPk <- liftIO $ Cache.lookup cache userName
  -- (_,nonce,pKey,_) <- case cachedPk of
  --   Just (KeyStore a b c d) -> pure (a,b,c,d)
  --   Nothing -> do
  --     mpk <- vaultTransaction
  --          . vaultQueryMaybe
  --          $ getUserKeyQuery userName
  --     (a,b,c,d) <- case mpk of
  --       Just pk -> return pk
  --       Nothing -> vaultWrapperError $ UserError ("User " <> userName <> " doesn't exist")
  --     liftIO . Cache.insert cache userName $ KeyStore a b c d
  --     pure (a,b,c,d)
  -- withSecretKey $ \key -> case decryptSecKey key nonce pKey of
  --   Nothing -> vaultWrapperError IncorrectPasswordError
  --   Just prvKey 
  --     | B.length msgBS == 32 -> return $ signMsg prvKey msgBS 
  --     | otherwise -> vaultWrapperError $ AnError "Message was not 32 bytes long"
