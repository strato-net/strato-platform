{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedLists   #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.Crypto where

import           Control.Lens.Operators            hiding ((.=))
import           Control.Lens                      (mapped, (&), (?~))
import           Control.Monad.IO.Class
import qualified Crypto.KDF.BCrypt                 as BCrypt
import qualified Crypto.KDF.Scrypt                 as Scrypt
import           Crypto.Random.Entropy
import qualified Crypto.Saltine.Class              as Saltine
import qualified Crypto.Saltine.Core.SecretBox     as SecretBox
import qualified Crypto.Saltine.Internal.ByteSizes as Saltine
import           Crypto.Secp256k1
import           Data.Aeson
import           Data.Aeson.Types
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString.Char8             as Char8
import qualified Data.ByteString.Base16            as B16
import qualified Data.ByteString.Base64            as B64
import           Data.Maybe
import           Data.String
import           Data.Swagger.Internal.Schema
import           Data.Text                         (Text)
import qualified Data.Text.Encoding                as Text
import           Generic.Random.Generic
import           GHC.Generics
import           Servant.Docs
import           Test.QuickCheck
import           Test.QuickCheck.Instances         ()
import           Web.FormUrlEncoded
import           Web.HttpApiData


import           BlockApps.Bloc22.API.SwaggerSchema
import           BlockApps.Ethereum


newtype Password = Password ByteString
  deriving (Eq,Show,Generic)

instance Arbitrary Password where
  arbitrary = genericArbitrary uniform

instance IsString Password where
  fromString = Password . Char8.pack

passwordText :: Password -> Text
passwordText (Password bs) = Text.decodeUtf8 bs

textPassword :: Text -> Password
textPassword = Password . Text.encodeUtf8

encodeB64 :: ByteString -> Value
encodeB64 = String . Text.decodeUtf8 . B64.encode

decodeB64 :: Value -> Parser ByteString
decodeB64 = withText "Base64 bytestring" $ \txt ->
  let eBs = B64.decode . Text.encodeUtf8 $ txt
  in case eBs of
    Left err -> fail $ "invalid base64 string: " ++ err
    Right bs -> return bs

instance Arbitrary SecretBox.Nonce where
  arbitrary = (fromMaybe Saltine.zero . Saltine.decode) <$> arbitrary

instance Show SecretBox.Nonce where
  show = show . Saltine.encode

data KeyStore = KeyStore
  { keystoreSalt          :: ByteString
  , keystorePasswordHash  :: ByteString
  , keystoreAcctNonce     :: SecretBox.Nonce
  , keystoreAcctEncSecKey :: ByteString
  , keystorePubKey        :: PubKey
  , keystoreAcctAddress   :: Address
  } deriving (Generic, Eq, Show)

instance Arbitrary KeyStore where
  arbitrary = genericArbitrary uniform

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

newKeyStore :: MonadIO io => Password -> io KeyStore
newKeyStore (Password pw) = liftIO $ do
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
