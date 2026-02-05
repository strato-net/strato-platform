{-# LANGUAGE BangPatterns #-}

-- |
-- Module      : Crypto.Curve.BabyJubJub.EdDSA
-- Description : EdDSA signatures over Baby JubJub
-- Copyright   : (c) BlockApps, 2026
-- License     : MIT
-- Maintainer  : info@blockapps.net
-- Stability   : experimental
--
-- EdDSA signature scheme over the Baby JubJub curve.
-- 
-- This implementation uses BLAKE2b for hashing by default, which is suitable
-- for off-chain signature generation. For in-circuit verification with
-- circom/snarkjs, use the Poseidon-based variants.
--
-- References:
--   - RFC 8032: Edwards-Curve Digital Signature Algorithm (EdDSA)
--   - circomlib eddsa.circom

module Crypto.Curve.BabyJubJub.EdDSA
  ( -- * Types
    PrivateKey(..)
  , PublicKey(..)
  , Signature(..)
    -- * Key generation
  , generateKeyPair
  , derivePublicKey
  , privateKeyFromBytes
  , privateKeyToBytes
    -- * Signing and verification
  , sign
  , verify
  , signWithNonce
    -- * Poseidon-based operations (for SNARK compatibility)
  , signPoseidon
  , verifyPoseidon
    -- * Low-level operations
  , hashToScalar
  , mulBaseClamp
  ) where

import Crypto.Hash (Blake2b_512, Digest, hash)
import Data.Bits (setBit, (.&.))
import Data.ByteArray (convert)
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import Data.Word (Word8)

import Crypto.Curve.BabyJubJub

-- | Private key (32-byte seed)
newtype PrivateKey = PrivateKey { unPrivateKey :: ByteString }
  deriving (Eq)

instance Show PrivateKey where
  show _ = "PrivateKey <redacted>"

-- | Public key (point on the curve)
newtype PublicKey = PublicKey { unPublicKey :: Point }
  deriving (Show, Eq)

-- | EdDSA signature (R point and S scalar)
data Signature = Signature
  { sigR :: !Point    -- ^ R = r * G
  , sigS :: !Integer  -- ^ S = r + h * s (mod l)
  } deriving (Show, Eq)

-- | Create a private key from 32 bytes
privateKeyFromBytes :: ByteString -> Maybe PrivateKey
privateKeyFromBytes bs
  | BS.length bs == 32 = Just (PrivateKey bs)
  | otherwise = Nothing

-- | Get the 32-byte representation of a private key
privateKeyToBytes :: PrivateKey -> ByteString
privateKeyToBytes = unPrivateKey

-- | Generate a key pair from a private key seed
generateKeyPair :: PrivateKey -> (PublicKey, PrivateKey)
generateKeyPair priv = (derivePublicKey priv, priv)

-- | Derive the public key from a private key
derivePublicKey :: PrivateKey -> PublicKey
derivePublicKey priv =
  let scalar = privateKeyToScalar priv
  in PublicKey $ scalarMultBase scalar

-- | Convert private key to scalar (with clamping for security)
privateKeyToScalar :: PrivateKey -> Integer
privateKeyToScalar (PrivateKey seed) =
  let h = hashBlake2b seed
      -- Take first 32 bytes and clamp
      scalar = clampScalar $ BS.take 32 h
  in scalar `mod` subgroupOrder

-- | Clamp a scalar according to EdDSA spec
-- Clear lowest 3 bits (cofactor clearing) and set bit 254
clampScalar :: ByteString -> Integer
clampScalar bs =
  let bytes = BS.unpack bs
      -- Clear bits 0, 1, 2 of first byte (cofactor = 8 = 2^3)
      byte0 = (bytes !! 0) .&. 0xF8
      -- Clear bit 255 and set bit 254 of last byte
      byte31 = ((bytes !! 31) .&. 0x7F) `setBit'` 6
      bytes' = [byte0] ++ (take 30 $ drop 1 bytes) ++ [byte31]
  in bytesToInteger bytes'
  where
    setBit' b n = fromIntegral (setBit (fromIntegral b :: Int) n) :: Word8

-- | Convert bytes to integer (little-endian)
bytesToInteger :: [Word8] -> Integer
bytesToInteger = foldr (\b acc -> acc * 256 + fromIntegral b) 0 . reverse

-- | Hash to scalar (for nonce generation)
hashToScalar :: ByteString -> Integer
hashToScalar bs =
  let h = hashBlake2b bs
      -- Use all 64 bytes, reduce mod subgroup order
  in bytesToInteger (BS.unpack h) `mod` subgroupOrder

-- | Scalar multiplication with base point after clamping
mulBaseClamp :: ByteString -> Point
mulBaseClamp bs = scalarMultBase (clampScalar bs `mod` subgroupOrder)

-- | Sign a message with a private key
sign :: PrivateKey -> ByteString -> Signature
sign priv msg =
  let -- Hash private key to get expanded key
      h = hashBlake2b (unPrivateKey priv)
      s = clampScalar (BS.take 32 h) `mod` subgroupOrder
      prefix = BS.drop 32 h
      
      -- Compute nonce r = H(prefix || msg)
      r = hashToScalar (prefix <> msg)
      
      -- R = r * G
      rPoint = scalarMultBase r
      
      -- Get public key
      pubKey = scalarMultBase s
      
      -- h = H(R || pubKey || msg)
      hScalar = hashToScalar (pointToBytes rPoint <> pointToBytes pubKey <> msg)
      
      -- S = (r + h * s) mod l
      sScalar = (r + hScalar * s) `mod` subgroupOrder
      
  in Signature rPoint sScalar

-- | Sign with an explicit nonce (for deterministic testing)
signWithNonce :: PrivateKey -> Integer -> ByteString -> Signature
signWithNonce priv nonce msg =
  let h = hashBlake2b (unPrivateKey priv)
      s = clampScalar (BS.take 32 h) `mod` subgroupOrder
      
      -- R = nonce * G
      rPoint = scalarMultBase (nonce `mod` subgroupOrder)
      
      -- Get public key
      pubKey = scalarMultBase s
      
      -- h = H(R || pubKey || msg)
      hScalar = hashToScalar (pointToBytes rPoint <> pointToBytes pubKey <> msg)
      
      -- S = (nonce + h * s) mod l
      sScalar = (nonce + hScalar * s) `mod` subgroupOrder
      
  in Signature rPoint sScalar

-- | Verify a signature
verify :: PublicKey -> ByteString -> Signature -> Bool
verify (PublicKey pubKey) msg (Signature rPoint sScalar) =
  -- Verify S is in valid range
  sScalar >= 0 && sScalar < subgroupOrder &&
  -- Verify R is on curve
  isOnCurve rPoint &&
  -- h = H(R || pubKey || msg)
  let hScalar = hashToScalar (pointToBytes rPoint <> pointToBytes pubKey <> msg)
      -- Verify: S * G == R + h * pubKey
      lhs = scalarMultBase sScalar
      rhs = pointAdd rPoint (scalarMult hScalar pubKey)
  in lhs == rhs

-- | Sign using Poseidon hash (for SNARK circuit compatibility)
-- Note: Requires external Poseidon implementation
-- The poseidonHash function should take a list of field elements
signPoseidon :: ([Integer] -> Integer)  -- ^ Poseidon hash function (list -> scalar)
             -> PrivateKey 
             -> Integer  -- ^ Message (as field element)
             -> Signature
signPoseidon poseidonHash priv msg =
  let h = hashBlake2b (unPrivateKey priv)
      s = clampScalar (BS.take 32 h) `mod` subgroupOrder
      
      -- For Poseidon-based EdDSA, nonce is derived differently
      -- r = H(s, msg) using Poseidon
      r = poseidonHash [s, msg] `mod` subgroupOrder
      
      -- R = r * G
      rPoint = scalarMultBase r
      (rx, ry) = case rPoint of
        Point x y -> (x, y)
        Infinity -> (0, 1)  -- Identity point
      
      -- Get public key
      pubKey = scalarMultBase s
      (ax, ay) = case pubKey of
        Point x y -> (x, y)
        Infinity -> (0, 1)
      
      -- h = Poseidon(Rx, Ry, Ax, Ay, msg)
      hScalar = poseidonHash [rx, ry, ax, ay, msg] `mod` subgroupOrder
      
      -- S = (r + h * s) mod l
      sScalar = (r + hScalar * s) `mod` subgroupOrder
      
  in Signature rPoint sScalar

-- | Verify using Poseidon hash (for SNARK circuit compatibility)
verifyPoseidon :: ([Integer] -> Integer)  -- ^ Poseidon hash function (list -> scalar)
               -> PublicKey 
               -> Integer  -- ^ Message (as field element)
               -> Signature 
               -> Bool
verifyPoseidon poseidonHash (PublicKey pubKey) msg (Signature rPoint sScalar) =
  sScalar >= 0 && sScalar < subgroupOrder &&
  isOnCurve rPoint &&
  let (rx, ry) = case rPoint of
        Point x y -> (x, y)
        Infinity -> (0, 1)
      (ax, ay) = case pubKey of
        Point x y -> (x, y)
        Infinity -> (0, 1)
      -- h = Poseidon(Rx, Ry, Ax, Ay, msg)
      hScalar = poseidonHash [rx, ry, ax, ay, msg] `mod` subgroupOrder
      -- Verify: S * G == R + h * pubKey
      lhs = scalarMultBase sScalar
      rhs = pointAdd rPoint (scalarMult hScalar pubKey)
  in lhs == rhs

-- | BLAKE2b-512 hash
hashBlake2b :: ByteString -> ByteString
hashBlake2b bs = convert (hash bs :: Digest Blake2b_512)
