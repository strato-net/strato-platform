{-# LANGUAGE DeriveGeneric #-}

module BlockApps.Bloc.Crypto where

import           Control.Monad.IO.Class
import qualified Crypto.KDF.BCrypt                 as BCrypt
import qualified Crypto.KDF.Scrypt                 as Scrypt
import           Crypto.Random.Entropy
import qualified Crypto.Saltine.Class              as Saltine
import qualified Crypto.Saltine.Core.SecretBox     as SecretBox
import qualified Crypto.Saltine.Internal.ByteSizes as Saltine
import           Crypto.Secp256k1
import           Data.Aeson
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString.Char8             as Char8
import           Data.Maybe
import           Data.String
import qualified Data.Text.Encoding                as Text
import           Generic.Random.Generic
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances         ()
import           Web.HttpApiData

import           BlockApps.Ethereum

newtype Password = Password ByteString
  deriving (Eq,Show,Generic)
instance ToJSON Password where
  toJSON (Password pw) = toJSON $ Text.decodeUtf8 pw
instance FromJSON Password where
  parseJSON = fmap (Password . Text.encodeUtf8) . parseJSON
instance Arbitrary Password where
  arbitrary = genericArbitrary uniform
instance IsString Password where
  fromString = Password . Char8.pack
instance ToHttpApiData Password where
  toUrlPiece (Password pw) = Text.decodeUtf8 pw
instance FromHttpApiData Password where
  parseUrlPiece = return . Password . Text.encodeUtf8

data KeyStore = KeyStore
  { keystoreSalt          :: ByteString
  , keystorePasswordHash  :: ByteString
  , keystoreAcctNonce     :: SecretBox.Nonce
  , keystoreAcctEncSecKey :: ByteString
  , keystorePubKey        :: PubKey
  , keystoreAcctAddress   :: Address
  }

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
