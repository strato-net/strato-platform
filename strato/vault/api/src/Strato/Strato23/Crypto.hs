{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.Crypto where

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Secp256k1
import Control.Monad ((<=<))
import Control.Monad.IO.Class
import Crypto.Random.Entropy
import qualified Crypto.Saltine.Core.SecretBox as SecretBox
import Data.ByteString (ByteString)
import Data.Text (Text)
import qualified Data.Text.Encoding as Text
import Text.Printf

newtype Password = Password ByteString
  deriving (Eq, Show)

passwordText :: Password -> Text
passwordText (Password bs) = Text.decodeUtf8 bs

textPassword :: Text -> Password
textPassword = Password . Text.encodeUtf8

data KeyStore = KeyStore
  { keystoreSalt :: ByteString, -- deprecated, since we use the password salt now
    keystoreAcctNonce :: SecretBox.Nonce,
    keystoreAcctEncSecKey :: ByteString,
    keystoreAcctAddress :: Address
  }
  deriving (Eq, Show)

decrypt ::
  SecretBox.Key ->
  SecretBox.Nonce ->
  ByteString -> -- encrypted secret key
  Maybe ByteString
decrypt = SecretBox.secretboxOpen

decryptSecKey ::
  SecretBox.Key ->
  SecretBox.Nonce ->
  ByteString -> -- encrypted secret key
  Maybe PrivateKey
decryptSecKey key nonce = importPrivateKey <=< decrypt key nonce

encrypt ::
  SecretBox.Key ->
  SecretBox.Nonce ->
  ByteString -> -- plaintext message
  ByteString -- ciphertext message
encrypt = SecretBox.secretbox

reencryptKey :: SecretBox.Key -> SecretBox.Key -> SecretBox.Nonce -> ByteString -> Address -> Either String ByteString
reencryptKey oldPass newPass nonce oldKey givenAddress =
  case decryptSecKey oldPass nonce oldKey of
    Nothing -> Left "could not decrypt account"
    Just plainKey ->
      let foundAddress = fromPrivateKey plainKey
       in if foundAddress /= givenAddress
            then
              Left $
                printf
                  "address mismatch (wrong password?): got %s, want %s"
                  (show foundAddress)
                  (show givenAddress)
            else Right $ encrypt newPass nonce (exportPrivateKey plainKey)

newSaltAndNonce :: MonadIO m => m (ByteString, SecretBox.Nonce)
newSaltAndNonce = liftIO $ do
  salt <- getEntropy 16
  nonce <- SecretBox.newNonce
  return (salt, nonce)

newKeyStore :: MonadIO m => SecretBox.Key -> m KeyStore
newKeyStore key = liftIO $ do
  -- BCrypt for password validation
  -- Scrypt for password derived encryption key
  -- NaCl SecretBox (XSalsa20 Poly1305) for encryption
  -- Secp256k1 for ethereum account creation
  (salt, acctNonce) <- newSaltAndNonce
  acctSk <- liftIO newPrivateKey
  let encAcctSk = encrypt key acctNonce $ exportPrivateKey acctSk
      acctAddr = fromPrivateKey acctSk
  return
    KeyStore
      { keystoreSalt = salt, -- Don't forget, this is unused now
        keystoreAcctNonce = acctNonce,
        keystoreAcctEncSecKey = encAcctSk,
        keystoreAcctAddress = acctAddr
      }
