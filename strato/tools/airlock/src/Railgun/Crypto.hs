{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE BangPatterns #-}

module Railgun.Crypto
  ( -- * BIP39 Mnemonic operations
    mnemonicToSeed
  , validateMnemonic
    -- * Hashing
  , keccak256
  , sha256
  , sha512
  , poseidonHash
    -- * Nullifier computation
  , computeNullifier
    -- * Encryption (ECIES compatible with noble-ed25519)
  , getSharedSymmetricKey
  , encryptRandom
  , decryptRandom
  , encryptWithCTR
  , decryptWithCTR
    -- * AES operations
  , aesEncryptGCM
  , aesDecryptGCM
  , aesEncryptCTR
  , aesDecryptCTR
    -- * Key derivation
  , deriveEd25519PubKey
  , getEd25519PublicKey
    -- * Random
  , randomBytes
  ) where

import Crypto.Cipher.AES (AES256)
import Crypto.Cipher.Types (cipherInit, ctrCombine, makeIV, IV, AuthTag(..), AEADMode(..), aeadInit, aeadSimpleEncrypt, aeadSimpleDecrypt)
import qualified Crypto.Hash.Poseidon as Poseidon
import Crypto.Error (CryptoFailable(..))
import Crypto.Hash (Digest, Keccak_256, SHA256, SHA512, hash)
import Crypto.KDF.PBKDF2 (Parameters(..), fastPBKDF2_SHA512)
import qualified Crypto.PubKey.Ed25519
import Crypto.Random (getRandomBytes)

import Data.ByteArray (convert)
import Data.Bits ((.&.), (.|.), shiftL, shiftR, testBit)
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE

-- | BIP39: Convert mnemonic phrase to seed using PBKDF2-SHA512
mnemonicToSeed :: Text -> Text -> ByteString
mnemonicToSeed mnemonic passphrase = 
  fastPBKDF2_SHA512 params mnemonicBytes saltBytes
  where
    params = Parameters 2048 64
    mnemonicBytes = TE.encodeUtf8 $ T.unwords $ T.words mnemonic
    saltBytes = TE.encodeUtf8 $ "mnemonic" <> passphrase

-- | Validate a mnemonic phrase (basic validation)
validateMnemonic :: Text -> Either Text ()
validateMnemonic mnemonic
  | wordCount `elem` [12, 15, 18, 21, 24] = Right ()
  | otherwise = Left $ "Invalid mnemonic: expected 12, 15, 18, 21, or 24 words, got " <> T.pack (show wordCount)
  where
    wordCount = length $ T.words mnemonic

-- | Keccak-256 hash (Ethereum's hash function)
keccak256 :: ByteString -> ByteString
keccak256 bs = convert (hash bs :: Digest Keccak_256)

-- | SHA-256 hash
sha256 :: ByteString -> ByteString
sha256 bs = convert (hash bs :: Digest SHA256)

-- | SHA-512 hash
sha512 :: ByteString -> ByteString
sha512 bs = convert (hash bs :: Digest SHA512)

-- | Poseidon hash - ZK-friendly hash over BN254 scalar field
-- Used by Railgun for computing NPK, commitments, and Merkle tree
poseidonHash :: [Integer] -> Integer
poseidonHash inputs = Poseidon.fromF $ Poseidon.poseidon (map Poseidon.toF inputs)

-- | Compute nullifier for spending a note
-- The nullifier is a unique identifier that prevents double-spending
-- Formula: nullifier = poseidon(nullifierKey, leafIndex, notePublicKey)
computeNullifier :: Integer  -- ^ Nullifier key (from RailgunKeys)
                 -> Integer  -- ^ Leaf index in merkle tree
                 -> Integer  -- ^ Note public key (npk)
                 -> Integer
computeNullifier nullifierKey leafIndex npk =
  poseidonHash [nullifierKey, leafIndex, npk]

-- ============================================================================
-- Ed25519 Curve Operations (for Railgun-compatible shared secret)
-- ============================================================================

-- | Ed25519 field prime: p = 2^255 - 19
ed25519P :: Integer
ed25519P = 2^(255::Int) - 19

-- | Ed25519 curve order (subgroup order): l = 2^252 + 27742317777372353535851937790883648493
ed25519L :: Integer
ed25519L = 2^(252::Int) + 27742317777372353535851937790883648493

-- | Ed25519 curve parameter d = -121665/121666 mod p
ed25519D :: Integer
ed25519D = 37095705934669439343138083508754565189542113879843219016388785533085940283555

-- | Square root of -1 mod p (used for point decompression)
sqrtM1 :: Integer
sqrtM1 = 19681161376707505956807079304988542015446066515923890162744021073123829784752

-- | Modular multiplicative inverse using Fermat's little theorem: a^(-1) = a^(p-2) mod p
modInverse :: Integer -> Integer
modInverse a = modPow a (ed25519P - 2) ed25519P

-- | Modular exponentiation
modPow :: Integer -> Integer -> Integer -> Integer
modPow base expo m = go base expo 1
  where
    go _ 0 !acc = acc
    go !b !e !acc = 
      let acc' = if e .&. 1 == 1 then (acc * b) `mod` m else acc
          b'   = (b * b) `mod` m
          e'   = e `shiftR` 1
      in go b' e' acc'

-- | Tonelli-Shanks square root mod p (for Ed25519, p ≡ 5 mod 8)
modSqrt :: Integer -> Maybe Integer
modSqrt a
  | a == 0 = Just 0
  | otherwise = 
      let -- For p ≡ 5 (mod 8): sqrt(a) = a^((p+3)/8) or i * a^((p+3)/8)
          candidate = modPow a ((ed25519P + 3) `div` 8) ed25519P
          check = (candidate * candidate) `mod` ed25519P
      in if check == a `mod` ed25519P
         then Just candidate
         else let candidate' = (candidate * sqrtM1) `mod` ed25519P
                  check' = (candidate' * candidate') `mod` ed25519P
              in if check' == a `mod` ed25519P
                 then Just candidate'
                 else Nothing

-- Helper for little-endian conversion
bytesToIntegerLE :: ByteString -> Integer
bytesToIntegerLE bs = foldr (\(i, b) acc -> acc + (fromIntegral b `shiftL` (i * 8))) 0 
                      $ zip [0..] (BS.unpack bs)

integerTo32BytesLE :: Integer -> ByteString
integerTo32BytesLE n = BS.pack $ take 32 $ map (\i -> fromIntegral $ (n `shiftR` (i * 8)) .&. 0xff) [0..31]

-- | Ed25519 point in extended coordinates (X, Y, Z, T) where x = X/Z, y = Y/Z, x*y = T/Z
data Ed25519Point = Ed25519Point !Integer !Integer !Integer !Integer
  deriving (Eq, Show)

-- | Identity point (0, 1, 1, 0)
pointIdentity :: Ed25519Point
pointIdentity = Ed25519Point 0 1 1 0

-- | Decompress Ed25519 point from 32-byte compressed format
pointDecompress :: ByteString -> Maybe Ed25519Point
pointDecompress bs
  | BS.length bs /= 32 = Nothing
  | otherwise = 
      let bytes = BS.unpack bs
          -- y is stored in first 255 bits (little endian), sign of x in bit 255
          yBytes = BS.pack $ take 31 bytes ++ [(bytes !! 31) .&. 0x7f]
          y = bytesToIntegerLE yBytes
          xSign = (bytes !! 31) `testBit` 7
          -- Recover x from curve equation: -x^2 + y^2 = 1 + d*x^2*y^2
          -- => x^2 = (y^2 - 1) / (d*y^2 + 1)
          y2 = (y * y) `mod` ed25519P
          num = (y2 - 1) `mod` ed25519P
          den = (ed25519D * y2 + 1) `mod` ed25519P
          x2 = (num * modInverse den) `mod` ed25519P
      in case modSqrt x2 of
           Nothing -> Nothing
           Just x -> 
             let x' = if (x .&. 1 == 1) /= xSign then ed25519P - x else x
             in Just $ Ed25519Point x' y 1 ((x' * y) `mod` ed25519P)

-- | Compress Ed25519 point to 32-byte format
pointCompress :: Ed25519Point -> ByteString
pointCompress (Ed25519Point x y z _) =
  let zInv = modInverse z
      xNorm = (x * zInv) `mod` ed25519P
      yNorm = (y * zInv) `mod` ed25519P
      yBytes = BS.unpack $ integerTo32BytesLE yNorm
      -- Set high bit of last byte based on x sign
      lastByte = if xNorm .&. 1 == 1 
                 then (yBytes !! 31) .|. 0x80 
                 else (yBytes !! 31) .&. 0x7f
  in BS.pack $ take 31 yBytes ++ [lastByte]

-- | Point addition using extended coordinates
pointAdd :: Ed25519Point -> Ed25519Point -> Ed25519Point
pointAdd (Ed25519Point x1 y1 z1 t1) (Ed25519Point x2 y2 z2 t2) =
  let a = ((y1 - x1) * (y2 - x2)) `mod` ed25519P
      b = ((y1 + x1) * (y2 + x2)) `mod` ed25519P
      c = (2 * t1 * ed25519D * t2) `mod` ed25519P
      d = (2 * z1 * z2) `mod` ed25519P
      e = (b - a) `mod` ed25519P
      f = (d - c) `mod` ed25519P
      g = (d + c) `mod` ed25519P
      h = (b + a) `mod` ed25519P
      x3 = (e * f) `mod` ed25519P
      y3 = (g * h) `mod` ed25519P
      t3 = (e * h) `mod` ed25519P
      z3 = (f * g) `mod` ed25519P
  in Ed25519Point x3 y3 z3 t3

-- | Point doubling
pointDouble :: Ed25519Point -> Ed25519Point
pointDouble (Ed25519Point x1 y1 z1 _) =
  let a = (x1 * x1) `mod` ed25519P
      b = (y1 * y1) `mod` ed25519P
      c = (2 * z1 * z1) `mod` ed25519P
      h = (a + b) `mod` ed25519P
      e = (h - ((x1 + y1) * (x1 + y1)) `mod` ed25519P) `mod` ed25519P
      g = (a - b) `mod` ed25519P
      f = (c + g) `mod` ed25519P
      x3 = (e * f) `mod` ed25519P
      y3 = (g * h) `mod` ed25519P
      t3 = (e * h) `mod` ed25519P
      z3 = (f * g) `mod` ed25519P
  in Ed25519Point x3 y3 z3 t3

-- | Scalar multiplication using double-and-add
scalarMult :: Integer -> Ed25519Point -> Ed25519Point
scalarMult n p = go n p pointIdentity
  where
    go 0 _ !acc = acc
    go !k !q !acc = 
      let acc' = if k .&. 1 == 1 then pointAdd acc q else acc
          q'   = pointDouble q
          k'   = k `shiftR` 1
      in go k' q' acc'

-- | Get private scalar from private key (Railgun-compatible)
-- SHA512 hash, take first 32 bytes, adjust bits, convert to scalar mod L
getPrivateScalar :: ByteString -> Integer
getPrivateScalar privKey =
  let hashed = sha512 privKey
      head32 = BS.take 32 hashed
      -- Adjust bytes for Ed25519 scalar (little endian)
      bytes = BS.unpack head32
      b0  = (bytes !! 0) .&. 0xf8  -- Clear lowest 3 bits
      b31 = ((bytes !! 31) .&. 0x7f) .|. 0x40  -- Clear bit 255, set bit 254
      adjusted = BS.pack $ b0 : take 30 (drop 1 bytes) ++ [b31]
      scalar = bytesToIntegerLE adjusted
  in if scalar > 0 then scalar `mod` ed25519L else ed25519L

-- | Get shared symmetric key (Railgun-compatible)
-- 1. Derive scalar from private key via SHA512 + bit adjustment
-- 2. Multiply other party's public key point by scalar
-- 3. SHA256 hash the result
getSharedSymmetricKey :: ByteString -> ByteString -> Maybe ByteString
getSharedSymmetricKey privateKey otherPublicKey = do
  -- Decompress the other party's public key to a point
  point <- pointDecompress otherPublicKey
  let scalar = getPrivateScalar privateKey
      -- Multiply point by scalar
      result = scalarMult scalar point
      -- Compress result to bytes and hash
      resultBytes = pointCompress result
  return $ sha256 resultBytes

-- | Get Ed25519 public key from private key
getEd25519PublicKey :: ByteString -> ByteString
getEd25519PublicKey privKey =
  case Crypto.PubKey.Ed25519.secretKey privKey of
    CryptoPassed sk -> convert $ Crypto.PubKey.Ed25519.toPublic sk
    CryptoFailed _ -> BS.replicate 32 0

-- | Derive Ed25519 public key from private key (alias)
deriveEd25519PubKey :: ByteString -> ByteString
deriveEd25519PubKey = getEd25519PublicKey

-- | AES-256-GCM encryption (real authenticated encryption)
-- Returns (iv, tag, ciphertext)
-- Note: Railgun uses 16-byte IV (not 12-byte NIST standard)
aesEncryptGCM :: ByteString  -- ^ Key (32 bytes)
              -> ByteString  -- ^ Plaintext
              -> IO (ByteString, ByteString, ByteString)  -- ^ (IV, Tag, Ciphertext)
aesEncryptGCM key plaintext = do
  iv <- getRandomBytes 16  -- Railgun uses 16-byte IV
  case cipherInit key :: CryptoFailable AES256 of
    CryptoPassed cipher ->
      case aeadInit AEAD_GCM cipher iv of
        CryptoPassed aead ->
          let (AuthTag tag, ciphertext) = aeadSimpleEncrypt aead BS.empty plaintext 16
          in return (iv, convert tag, ciphertext)
        CryptoFailed _ -> error "aesEncryptGCM: AEAD init failed"
    CryptoFailed _ -> error "aesEncryptGCM: cipher init failed"

-- | AES-256-GCM decryption (real authenticated decryption)
aesDecryptGCM :: ByteString  -- ^ Key (32 bytes)
              -> ByteString  -- ^ IV (12 bytes for GCM)
              -> ByteString  -- ^ Tag (16 bytes)
              -> ByteString  -- ^ Ciphertext
              -> Maybe ByteString  -- ^ Plaintext (Nothing if auth fails)
aesDecryptGCM key iv tag ciphertext =
  case cipherInit key :: CryptoFailable AES256 of
    CryptoPassed cipher ->
      case aeadInit AEAD_GCM cipher iv of
        CryptoPassed aead ->
          aeadSimpleDecrypt aead BS.empty ciphertext (AuthTag (convert tag))
        CryptoFailed _ -> Nothing
    CryptoFailed _ -> Nothing

-- | AES-256-CTR encryption
aesEncryptCTR :: ByteString  -- ^ Key (32 bytes)
              -> ByteString  -- ^ Plaintext
              -> IO (ByteString, ByteString)  -- ^ (IV, Ciphertext)
aesEncryptCTR key plaintext = do
  iv <- getRandomBytes 16
  case cipherInit key :: CryptoFailable AES256 of
    CryptoPassed cipher ->
      case makeIV iv :: Maybe (IV AES256) of
        Just ivObj -> return (iv, ctrCombine cipher ivObj plaintext)
        Nothing -> return (iv, plaintext)
    CryptoFailed _ -> return (iv, plaintext)

-- | AES-256-CTR decryption (same as encryption for CTR mode)
aesDecryptCTR :: ByteString -> ByteString -> ByteString -> ByteString
aesDecryptCTR key iv ciphertext =
  case cipherInit key :: CryptoFailable AES256 of
    CryptoPassed cipher ->
      case makeIV iv :: Maybe (IV AES256) of
        Just ivObj -> ctrCombine cipher ivObj ciphertext
        Nothing -> ciphertext
    CryptoFailed _ -> ciphertext

-- | Encrypt random value using shared key (AES-GCM)
-- Returns: (ivAndTag, encryptedRandom) where ivAndTag = iv || tag
encryptRandom :: ByteString  -- ^ Shared key (32 bytes)
              -> ByteString  -- ^ Random value (16 bytes)
              -> IO (ByteString, ByteString)  -- ^ (iv||tag, encrypted)
encryptRandom sharedKey randomValue = do
  (iv, tag, encrypted) <- aesEncryptGCM sharedKey randomValue
  return (iv <> tag, encrypted)

-- | Decrypt random value using shared key (AES-GCM)
decryptRandom :: ByteString  -- ^ Shared key (32 bytes)
              -> ByteString  -- ^ IV || Tag (32 bytes: 16-byte IV + 16-byte tag)
              -> ByteString  -- ^ Encrypted random
              -> Maybe ByteString
decryptRandom sharedKey ivAndTag encrypted =
  let iv = BS.take 16 ivAndTag   -- Railgun uses 16-byte IV
      tag = BS.drop 16 ivAndTag  -- 16-byte auth tag
  in aesDecryptGCM sharedKey iv tag encrypted

-- | Encrypt data using AES-CTR with a key (not shared secret)
encryptWithCTR :: ByteString  -- ^ Key (32 bytes)
               -> ByteString  -- ^ Plaintext
               -> IO (ByteString, ByteString)  -- ^ (IV, Ciphertext)
encryptWithCTR = aesEncryptCTR

-- | Decrypt data using AES-CTR
decryptWithCTR :: ByteString  -- ^ Key (32 bytes)
               -> ByteString  -- ^ IV
               -> ByteString  -- ^ Ciphertext
               -> ByteString
decryptWithCTR = aesDecryptCTR

-- | Generate random bytes
randomBytes :: Int -> IO ByteString
randomBytes = getRandomBytes
