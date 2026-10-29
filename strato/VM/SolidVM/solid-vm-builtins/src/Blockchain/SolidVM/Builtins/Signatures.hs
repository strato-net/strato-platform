{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM.Builtins.Signatures (RecoverHash, ecrecover, verifyP256, p256PublicKeyFromHex) where

import Blockchain.VM.SolidException (invalidArguments)
import qualified Data.ByteString as B
import qualified Data.Text as T
import qualified Data.Text.Encoding as DT
import Blockchain.Data.Util (integer2Bytes)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.Model.Secp256k1 as EC
import Crypto.ECC (Curve_P256R1)
import Crypto.Error
import "crypton" Crypto.Hash (SHA256, digestFromByteString)
import qualified Crypto.PubKey.ECC.P256 as P256
import Crypto.PubKey.ECDSA (signatureFromIntegers, verifyDigest)
import qualified Crypto.Secp256k1 as SEC
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Short as BSS
import Data.Maybe (fromMaybe)
import Data.Proxy (Proxy (..))
import Data.Word (Word8)

class RecoverHash a where
  recoverHash :: a -> B.ByteString

instance RecoverHash B.ByteString where
  recoverHash = id

instance RecoverHash Integer where
  recoverHash = integer2Bytes

instance RecoverHash Address where
  recoverHash = B.pack . word160ToBytes . unAddress

instance RecoverHash T.Text where
  recoverHash value = either (const $ DT.encodeUtf8 value) id (B16.decode $ DT.encodeUtf8 value)

instance RecoverHash () where
  recoverHash = const B.empty

ecrecover :: RecoverHash a => a -> Integer -> Integer -> Integer -> Address
ecrecover input v r s = fromMaybe 0 $ fromPublicKey <$> EC.recoverPub sig mesg
  where
    intToBSS = BSS.toShort . word256ToBytes . fromInteger
    sig = EC.Signature (SEC.CompactRecSig (intToBSS r) (intToBSS s) ((fromInteger v :: Word8) - 0x1b))
    mesg = keccak256ToByteString $ unsafeCreateKeccak256FromByteString (recoverHash input)

verifyP256 :: Monad m => B.ByteString -> m (Either (Integer, Integer) B.ByteString) -> m (Integer, Integer) -> m Bool
verifyP256 h publicKey signature = case digestFromByteString @SHA256 h of
  Nothing -> invalidArguments "Could not decode hash from string" h
  Just digest -> do
    key <- publicKey
    pub <- case key of
      Left coordinates -> pure $ P256.pointFromIntegers coordinates
      Right pubBS' -> do
        pubBS <- case B.length pubBS' of
          65 -> pure $ B.drop 1 pubBS'
          64 -> pure pubBS'
          _ -> invalidArguments "Could not decode public key from bytestring: invalid length" pubBS'
        case P256.pointFromBinary pubBS of
          CryptoPassed p -> pure p
          CryptoFailed e -> invalidArguments "Could not decode public key from bytestring" (pubBS', e)
    (r,s) <- signature
    sig <- case signatureFromIntegers (Proxy @Curve_P256R1) (r, s) of
      CryptoPassed sig' -> pure sig'
      CryptoFailed e -> invalidArguments "Invalid P256 signature" e
    let !isValidSig = verifyDigest (Proxy @Curve_P256R1) pub sig digest
    pure isValidSig

p256PublicKeyFromHex :: String -> B.ByteString
p256PublicKeyFromHex value = case B16.decode $ DT.encodeUtf8 $ T.pack value of
  Left e -> invalidArguments "Could not decode public key from string: invalid hex" (value, e)
  Right bytes -> bytes
