{-# LANGUAGE OverloadedLists   #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.Crypto where

import           BlockApps.Ethereum                hiding (deriveAddress)
import           Control.Monad.IO.Class
import qualified Crypto.KDF.Scrypt                 as Scrypt
import           Crypto.Random.Entropy
import qualified Crypto.Saltine.Class              as Saltine
import qualified Crypto.Saltine.Core.SecretBox     as SecretBox
import qualified Crypto.Saltine.Internal.ByteSizes as Saltine
import           Crypto.Secp256k1
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString                   as BS
import           Data.Maybe
import           Data.Text                         (Text)
import qualified Data.Text.Encoding                as Text

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

decryptSecKey
  :: Password
  -> ByteString -- salt
  -> SecretBox.Nonce
  -> ByteString -- encrypted secret key
  -> Maybe SecKey
decryptSecKey (Password pw) salt nonce encSecKey = do
  decKey <- Saltine.decode $ Scrypt.generate scryptParams pw salt
  secKey =<< SecretBox.secretboxOpen decKey nonce encSecKey
  where
    scryptParams = Scrypt.Parameters
      { Scrypt.n = 16384
      , Scrypt.r = 8
      , Scrypt.p = 1
      , Scrypt.outputLength = Saltine.secretBoxKey
      }

deriveAddress :: SecKey -> Address
deriveAddress = keccak256Address . BS.drop 1 . exportPubKey False . derivePubKey

newKeyStore :: MonadIO io => Password -> io KeyStore
newKeyStore (Password pw) = liftIO $ do
  -- BCrypt for password validation
  -- Scrypt for password derived encryption key
  -- NaCl SecretBox (XSalsa20 Poly1305) for encryption
  -- Secp256k1 for ethereum account creation
  salt <- getEntropy 16
  acctNonce <- SecretBox.newNonce
  acctSk <- liftIO newSecKey
  let
    scryptParams = Scrypt.Parameters
      { Scrypt.n = 16384
      , Scrypt.r = 8
      , Scrypt.p = 1
      , Scrypt.outputLength = Saltine.secretBoxKey
      }
    err = error "could not decode encryption key"
    encKey = fromMaybe err . Saltine.decode $
      Scrypt.generate scryptParams pw salt
    encAcctSk = SecretBox.secretbox encKey acctNonce (getSecKey acctSk)
    acctAddr = deriveAddress acctSk
  return KeyStore
    { keystoreSalt = salt
    , keystoreAcctNonce = acctNonce
    , keystoreAcctEncSecKey = encAcctSk
    , keystoreAcctAddress = acctAddr
    }
