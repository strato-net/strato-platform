{-# LANGUAGE
    DeriveGeneric
#-}

module BlockApps.Bloc.Crypto where

import qualified Crypto.KDF.BCrypt as BCrypt
import qualified Crypto.KDF.Scrypt as Scrypt
import Crypto.Random.Entropy
import Crypto.Secp256k1
import qualified Crypto.Saltine.Core.SecretBox as SecretBox
import qualified Crypto.Saltine.Internal.ByteSizes as Saltine
import qualified Crypto.Saltine.Class as Saltine
import Data.ByteString (ByteString)
import Data.Maybe

import BlockApps.Ethereum

newtype Password = Password ByteString

data KeyStore = KeyStore
  { keystoreSalt :: ByteString
  , keystorePasswordHash :: ByteString
  , keystoreAcctNonce :: SecretBox.Nonce
  , keystoreAcctEncSecKey :: ByteString
  , keystorePubKey :: PubKey
  , keystoreAcctAddress :: Address
  }

newKeyStore :: Password -> IO KeyStore
newKeyStore (Password pw) = do
  -- BCrypt for password validation
  -- Scrypt for password derived encryption key
  -- NaCl SecretBox (XSalsa20 Poly1305) for encryption
  -- Secp256k1 for ethereum account creation
  salt <- getEntropy 16
  acctNonce <- SecretBox.newNonce
  acctSk <- newSecKey
  pwHash <- BCrypt.hashPassword 6 pw
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
    acctPk = derivePubKey acctSk
    acctAddr = deriveAddress acctPk
  return KeyStore
    { keystoreSalt = salt
    , keystorePasswordHash = pwHash
    , keystoreAcctNonce = acctNonce
    , keystoreAcctEncSecKey = encAcctSk
    , keystorePubKey = acctPk
    , keystoreAcctAddress = acctAddr
    }
