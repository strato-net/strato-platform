{-# LANGUAGE OverloadedLists   #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.Crypto where

import           BlockApps.Ethereum                hiding (deriveAddress)
import           Control.Monad                     ((<=<))
import           Control.Monad.IO.Class
import qualified Crypto.KDF.Scrypt                 as Scrypt
import           Crypto.Random.Entropy
import qualified Crypto.Saltine.Class              as Saltine
import qualified Crypto.Saltine.Core.SecretBox     as SecretBox
import qualified Crypto.Saltine.Internal.ByteSizes as Saltine
import           Crypto.HaskoinShim
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString                   as BS
import           Data.Maybe
import           Data.Text                         (Text)
import qualified Data.Text.Encoding                as Text
import           Text.Printf

newtype Password = Password ByteString
  deriving (Eq,Show)

passwordText :: Password -> Text
passwordText (Password bs) = Text.decodeUtf8 bs

textPassword :: Text -> Password
textPassword = Password . Text.encodeUtf8

instance Show SecretBox.Nonce where
  show = show . Saltine.encode

data KeyStore = KeyStore
  { keystoreSalt          :: ByteString
  , keystoreAcctNonce     :: SecretBox.Nonce
  , keystoreAcctEncSecKey :: ByteString
  , keystoreAcctAddress   :: Address
  } deriving (Eq, Show)

decrypt
  :: Password
  -> ByteString -- salt
  -> SecretBox.Nonce
  -> ByteString -- encrypted secret key
  -> Maybe ByteString
decrypt (Password pw) salt nonce encMsg = do
  decKey <- Saltine.decode $ Scrypt.generate scryptParams pw salt
  SecretBox.secretboxOpen decKey nonce encMsg
  where
    scryptParams = Scrypt.Parameters
      { Scrypt.n = 16384
      , Scrypt.r = 8
      , Scrypt.p = 1
      , Scrypt.outputLength = Saltine.secretBoxKey
      }

decryptSecKey
  :: Password
  -> ByteString -- salt
  -> SecretBox.Nonce
  -> ByteString -- encrypted secret key
  -> Maybe SecKey
decryptSecKey pw salt nonce = secKey <=< decrypt pw salt nonce

encrypt
  :: Password
  -> ByteString -- salt
  -> SecretBox.Nonce
  -> ByteString -- plaintext message
  -> ByteString -- ciphertext message
encrypt (Password pw) salt nonce plaintext =
  let scryptParams = Scrypt.Parameters
        { Scrypt.n = 16384
        , Scrypt.r = 8
        , Scrypt.p = 1
        , Scrypt.outputLength = Saltine.secretBoxKey
        }
      err = error "could not decode encryption key"
      encKey = fromMaybe err . Saltine.decode $
        Scrypt.generate scryptParams pw salt
   in SecretBox.secretbox encKey nonce plaintext

reencryptKey :: Password -> Password -> ByteString -> SecretBox.Nonce -> ByteString -> Address -> Either String ByteString
reencryptKey oldPass newPass salt nonce oldKey givenAddress=
  case decryptSecKey oldPass salt nonce oldKey of
    Nothing -> Left "could not decrypt account"
    Just plainKey -> let foundAddress = deriveAddress plainKey
                     in if foundAddress /= givenAddress
                          then Left $ printf "address mismatch (wrong password?): got %s, want %s"
                                             (show foundAddress)
                                             (show givenAddress)
                          else Right $ encrypt newPass salt nonce (getSecKey plainKey)

deriveAddress :: SecKey -> Address
deriveAddress = keccak256Address . BS.drop 1 . exportPubKey False . derivePubKey

newSaltAndNonce :: MonadIO m => m (ByteString, SecretBox.Nonce)
newSaltAndNonce = liftIO $ do
  salt <- getEntropy 16
  nonce <- SecretBox.newNonce
  return (salt, nonce)

newKeyStore :: MonadIO m => Password -> m KeyStore
newKeyStore pw = liftIO $ do
  -- BCrypt for password validation
  -- Scrypt for password derived encryption key
  -- NaCl SecretBox (XSalsa20 Poly1305) for encryption
  -- Secp256k1 for ethereum account creation
  (salt, acctNonce) <- newSaltAndNonce
  acctSk <- liftIO newSecKey
  let encAcctSk = encrypt pw salt acctNonce $ getSecKey acctSk
      acctAddr = deriveAddress acctSk
  return KeyStore
    { keystoreSalt = salt
    , keystoreAcctNonce = acctNonce
    , keystoreAcctEncSecKey = encAcctSk
    , keystoreAcctAddress = acctAddr
    }
