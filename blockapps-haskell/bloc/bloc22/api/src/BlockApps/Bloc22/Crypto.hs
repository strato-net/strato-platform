{-# LANGUAGE OverloadedLists   #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Bloc22.Crypto where

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
import qualified Data.Text.Encoding                as Text
import qualified Generic.Random                    as GR
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

instance ToParamSchema Password where
  toParamSchema = const passwordParamSchema

instance ToSchema Password where
  declareNamedSchema _ = return $ NamedSchema (Just "Password")
    ( mempty
      & type_ .~ SwaggerString
      & example ?~ toJSON (Password "securePassword")
      & description ?~ "Password" )

instance ToJSON Password where
  toJSON (Password pw) = toJSON $ Text.decodeUtf8 pw

instance FromJSON Password where
  parseJSON = fmap (Password . Text.encodeUtf8) . parseJSON

instance Arbitrary Password where
  arbitrary = GR.genericArbitrary GR.uniform

instance IsString Password where
  fromString = Password . Char8.pack

instance ToHttpApiData Password where
  toUrlPiece (Password pw) = Text.decodeUtf8 pw

instance FromHttpApiData Password where
  parseUrlPiece = return . Password . Text.encodeUtf8

instance ToForm Password where
  toForm pw = [ ("password", toQueryParam pw) ]

instance FromForm Password where
  fromForm = parseUnique "password"

instance ToSample Password where
  toSamples _ = singleSample $ Password "p4$$w0rd"

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

instance ToJSON KeyStore where
  toJSON KeyStore{..} = object [
    "salt" .= encodeB64 keystoreSalt,
    "passwordHash" .= encodeB64 keystorePasswordHash,
    "keystoreNonce" .= (encodeB64 . Saltine.encode $ keystoreAcctNonce),
    "encryptedSecretKey" .= encodeB64 keystoreAcctEncSecKey,
    "publicKey" .= (encodeB64 . exportPubKey False $ keystorePubKey),
    "accountAddress" .= toJSON keystoreAcctAddress
    ]

instance FromJSON KeyStore where
  parseJSON = withObject "KeyStore" $ \obj -> do
      mNonce <- Saltine.decode <$> (decodeB64 =<< obj .: "keystoreNonce")
      let nonce = case mNonce of
                      Nothing -> fail "KeyStore: invalid nonce"
                      Just n -> pure n
      mPubkey <- importPubKey <$> (decodeB64 =<< obj .: "publicKey")
      let pubkey = case mPubkey of
                       Nothing -> fail "KeyStore: invalid public key"
                       Just pk -> pure pk
      KeyStore
        <$> (decodeB64 =<< obj .: "salt")
        <*> (decodeB64 =<< obj .: "passwordHash")
        <*> nonce
        <*> (decodeB64 =<< obj .: "encryptedSecretKey")
        <*> pubkey
        <*> obj .: "accountAddress"

instance ToSample KeyStore where
  toSamples _ = noSamples

instance Arbitrary KeyStore where
  arbitrary = GR.genericArbitrary GR.uniform

instance GToSchema (K1 i ByteString) where
  gdeclareNamedSchema _ _ _ = pure $ NamedSchema Nothing byteSchema

instance ToSchema SecretBox.Nonce where
  declareNamedSchema _ = pure . NamedSchema (Just "SecretBox.Nonce") $
      mempty
      & description ?~ "Nonce used is secretbox projection of privatekey"

instance ToSchema PubKey where
  declareNamedSchema _ = pure . NamedSchema (Just "PubKey") $
    mempty
    & description ?~ "Secp256k1 Public Key"

instance ToSchema KeyStore where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "KeyStore entry"
    & mapped.schema.example ?~ toJSON exKeyStore

exKeyStore :: KeyStore
exKeyStore  = KeyStore
   { keystoreSalt = fst . B16.decode $ "991c49cfcefcf5abdd132fac62faa2fa"
   , keystorePasswordHash = fst . B16.decode $
      "243261243036243947634f5443524f334f6b4f6779336f715239512e4f314453334d6a32737457376e726d45386554373273772e33644f6b3145772e"
   , keystoreAcctNonce = fromMaybe (error "invalid nonce") . Saltine.decode
                       . fst . B16.decode $
      "af56c61ed12c436e66b4dc1a81c73561f025bc9fddc11fd5"
   , keystoreAcctEncSecKey = fst . B16.decode $
      "fb37fca0e7a024e08db368e528bb41e2b62dcd09f5176d90589d5a5bae4ffd4c3a358824645a37b806b0883182f2e115"
   , keystorePubKey = fromMaybe (error "invalid pubkey") . importPubKey
                    . fst . B16.decode $
       "04def1514a3f8d191470e08667d90b6e584b3235fe97aa279ab5d21b253d562f857a9917ca7e8836c272d5f5c65ce7c40191d286002b150206f93b8f11b6811b93"
   , keystoreAcctAddress = Address 0x97b8c8d8334b6f3cd15e4e09986741e76b32c0f1
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
