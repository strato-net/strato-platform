{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Strato23.Server.Password where

import           Control.Monad.IO.Class
import           Control.Monad.Reader
import           Data.ByteString                  (ByteString)
import           Data.Maybe                       (listToMaybe)
import           Data.IORef
import           Data.Text                        (Text)
import           Data.Text.Encoding               (encodeUtf8)
import           Database.PostgreSQL.Simple       (Connection)

import           Strato.Strato23.Crypto
import           Strato.Strato23.Database.Queries
import           Strato.Strato23.Monad

superSecretVaultWrapperMessage :: ByteString
superSecretVaultWrapperMessage =
  "A monad is just a monoid in the category of endofunctors, what's the problem?"

setPassword :: Password -> Connection -> IO Bool
setPassword pw conn = do
  (salt, nonce) <- newSaltAndNonce
  let ciphertext = encrypt pw
                           salt
                           nonce
                           superSecretVaultWrapperMessage
  postMessageQuery salt nonce ciphertext conn

postPassword :: Text -> VaultM ()
postPassword password = do
  existingPassword <- asks superSecretPassword
  doIAlreadyHaveAPassword <- liftIO $ readIORef existingPassword
  let pw = encodeUtf8 password
  case doIAlreadyHaveAPassword of
    Just _ -> vaultWrapperError $ UserError "Password is already set"
    Nothing -> do
      mMsg <- listToMaybe <$> vaultQuery getMessageQuery
      case mMsg of
        Nothing -> do
          success <- vaultModify . setPassword $ Password pw
          if success
            then liftIO . atomicWriteIORef existingPassword $ Just password
            else vaultWrapperError $ AnError "Failed to insert encrypted message into database"
        Just (salt, nonce, ciphertext) ->
          case decrypt (Password pw) salt nonce ciphertext of
            Just msg | msg == superSecretVaultWrapperMessage ->
              liftIO . atomicWriteIORef existingPassword $ Just password
            _ -> vaultWrapperError $ UserError "Could not validate password"

verifyPassword :: VaultM Bool
verifyPassword = do 
  existingPassword <- asks superSecretPassword
  doIAlreadyHaveAPassword <- liftIO $ readIORef existingPassword
  return $ maybe False (const True) doIAlreadyHaveAPassword