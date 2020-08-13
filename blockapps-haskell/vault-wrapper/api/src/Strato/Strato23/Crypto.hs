{-# LANGUAGE OverloadedLists   #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.Crypto where

import           Control.Monad                     ((<=<))
import           Control.Monad.IO.Class
import           Crypto.Random.Entropy
import qualified Crypto.Saltine.Class              as Saltine
import qualified Crypto.Saltine.Core.SecretBox     as SecretBox
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString                   as B
import           Data.Maybe
import           Data.Text                         (Text)
import qualified Data.Text.Encoding                as Text
import           Text.Printf

import           Blockchain.Strato.Model.Address
import qualified Blockchain.Strato.Model.Keccak256 as SHA
import           Crypto.Secp256k1



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
  , keystoreAcctPubKey    :: PubKey
  } deriving (Eq, Show)

decrypt
  :: SecretBox.Key
  -> SecretBox.Nonce
  -> ByteString -- encrypted secret key
  -> Maybe ByteString
decrypt = SecretBox.secretboxOpen

decryptSecKey
  :: SecretBox.Key
  -> SecretBox.Nonce
  -> ByteString -- encrypted secret key
  -> Maybe SecKey
decryptSecKey pw nonce = secKey <=< decrypt pw nonce

encrypt
  :: SecretBox.Key
  -> SecretBox.Nonce
  -> ByteString -- plaintext message
  -> ByteString -- ciphertext message
encrypt = SecretBox.secretbox

reencryptKey :: SecretBox.Key -> SecretBox.Key -> SecretBox.Nonce -> ByteString -> Address -> Either String ByteString
reencryptKey oldPass newPass nonce oldKey givenAddress=
  case decryptSecKey oldPass nonce oldKey of
    Nothing -> Left "could not decrypt account"
    Just plainKey -> let foundAddress = deriveAddress plainKey
                     in if foundAddress /= givenAddress
                          then Left $ printf "address mismatch (wrong password?): got %s, want %s"
                                             (show foundAddress)
                                             (show givenAddress)
                          else Right $ encrypt newPass nonce (getSecKey plainKey)



-- first byte of serialized pubkey is metdata, so we drop it
-- TODO: add a test against sample pubkey/address values to ensure this, maybe once
-- this code is moved to strato-model/Address.hs
deriveAddress :: SecKey -> Address
deriveAddress = Address . fromIntegral . SHA.keccak256ToWord256 . SHA.hash . B.drop 1 . exportPubKey False . derivePubKey 

-- TODO: temporary proxy for secp256k1's derivePubKey, until the new crypto module is merged
derivePublicKey :: SecKey -> PubKey
derivePublicKey = derivePubKey

newSaltAndNonce :: MonadIO m => m (ByteString, SecretBox.Nonce)
newSaltAndNonce = liftIO $ do
  salt <- getEntropy 16
  nonce <- SecretBox.newNonce
  return (salt, nonce)

newKeyStore :: MonadIO m => SecretBox.Key -> m KeyStore
newKeyStore pw = liftIO $ do
  -- BCrypt for password validation
  -- Scrypt for password derived encryption key
  -- NaCl SecretBox (XSalsa20 Poly1305) for encryption
  -- Secp256k1 for ethereum account creation
  (salt, acctNonce) <- newSaltAndNonce
  acctSk <- liftIO newSecKey
  let encAcctSk = encrypt pw acctNonce $ getSecKey acctSk
      acctAddr = deriveAddress acctSk
      acctPubKey = derivePubKey acctSk
  return KeyStore
    { keystoreSalt = salt
    , keystoreAcctNonce = acctNonce
    , keystoreAcctEncSecKey = encAcctSk
    , keystoreAcctAddress = acctAddr
    , keystoreAcctPubKey = acctPubKey
    }

newSecKey :: IO SecKey
newSecKey = fromMaybe err . secKey <$> getEntropy 32
  where
    err = error "could not generate secret key"

