{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Strato23.Server.Password where

import Control.Monad.IO.Class
import Control.Monad.Reader
import qualified Crypto.KDF.Scrypt as Scrypt
import qualified Crypto.Saltine.Class as Saltine
import qualified Crypto.Saltine.Core.SecretBox as SecretBox
import Data.ByteString (ByteString)
import Data.IORef
import Data.Maybe (fromMaybe, isJust, listToMaybe)
import Data.Text (Text)
import Data.Text.Encoding (encodeUtf8)
import Database.PostgreSQL.Simple (Connection)
import Strato.Strato23.Crypto
import Strato.Strato23.Database.Queries
import Strato.Strato23.Monad

superSecretVaultWrapperMessage :: ByteString
superSecretVaultWrapperMessage =
  "A monad is just a monoid in the category of endofunctors, what's the problem?"

getKeyFromPasswordAndSalt :: Password -> ByteString -> SecretBox.Key
getKeyFromPasswordAndSalt (Password pw) salt =
  let scryptParams =
        Scrypt.Parameters
          { Scrypt.n = 16384,
            Scrypt.r = 8,
            Scrypt.p = 1,
            Scrypt.outputLength = 32 -- ???? could break everything
          }
   in fromMaybe (error "could not decode encryption key") . Saltine.decode $
        Scrypt.generate scryptParams pw salt

setPassword :: Password -> Connection -> IO (Maybe SecretBox.Key)
setPassword pw conn = do
  (salt, nonce) <- newSaltAndNonce
  let key = getKeyFromPasswordAndSalt pw salt
  let ciphertext =
        encrypt
          key
          nonce
          superSecretVaultWrapperMessage
  success <- postMessageQuery salt nonce ciphertext conn
  if success
    then return $ Just key
    else return Nothing

postPassword :: Text -> VaultM ()
postPassword password = do
  existingKey <- asks superSecretKey
  doIAlreadyHaveAKey <- liftIO $ readIORef existingKey

  case doIAlreadyHaveAKey of
    Just _ -> vaultWrapperError $ UserError "Password is already set"
    Nothing -> do
      mMsg <- listToMaybe <$> vaultQuery getMessageQuery
      case mMsg of
        Nothing -> do
          maybeKey <- vaultModify . setPassword $ Password $ encodeUtf8 password
          case maybeKey of
            Just key -> liftIO . atomicWriteIORef existingKey $ Just key
            Nothing -> vaultWrapperError $ AnError "Failed to insert encrypted message into database"
        Just (salt :: ByteString, nonce, ciphertext) -> do
          let key = getKeyFromPasswordAndSalt (Password $ encodeUtf8 password) salt
          case decrypt key nonce ciphertext of
            Just msg
              | msg == superSecretVaultWrapperMessage ->
                liftIO . atomicWriteIORef existingKey $ Just key
            _ -> vaultWrapperError $ UserError "Could not validate password"

verifyPassword :: VaultM Bool
verifyPassword = do
  existingKey <- asks superSecretKey
  doIAlreadyHaveAKey <- liftIO $ readIORef existingKey
  return $ isJust doIAlreadyHaveAKey
