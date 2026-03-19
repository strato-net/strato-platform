{-# LANGUAGE OverloadedStrings #-}

-- | EdDSA signing for Railgun circuits using Baby JubJub curve
-- 
-- Railgun's SNARK circuits use EdDSA over the Baby JubJub curve with
-- Poseidon hash for message hashing. This module provides the signing
-- functionality needed to generate valid SNARK witnesses.
--
-- IMPORTANT: The signing key scalar must be derived identically to how
-- the masterPublicKey is derived in Railgun.Keys, i.e., using raw
-- little-endian conversion without hashing/clamping. This ensures the
-- EdDSA public key matches what the circuit receives.

module Railgun.Signing
  ( -- * Types
    RailgunSignature(..)
  , RailgunSigningKey(..)
    -- * Key derivation
  , deriveSigningKey
  , getSigningPublicKey
    -- * Signing
  , signTransactionData
  , computeSignatureMessage
  ) where

import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import Data.Bits (shiftL)

import qualified Crypto.Curve.BabyJubJub as BJJ
import qualified Crypto.Curve.BabyJubJub.EdDSA as EdDSA
import Railgun.Crypto (poseidonHash)

-- | Railgun signing key (derived from spending key)
-- Uses raw scalar derivation (same as masterPublicKey in Railgun.Keys)
data RailgunSigningKey = RailgunSigningKey
  { rskPrivateScalar :: Integer  -- ^ Private scalar (raw, not hashed/clamped)
  , rskPublicKey     :: BJJ.Point  -- ^ Public key point
  } deriving (Show)

-- | Railgun EdDSA signature components for circuit input
data RailgunSignature = RailgunSignature
  { rsR8x :: Integer  -- ^ R point X coordinate
  , rsR8y :: Integer  -- ^ R point Y coordinate  
  , rsS   :: Integer  -- ^ S scalar
  } deriving (Show, Eq)

-- | Convert bytes to integer (little-endian)
bytesToIntegerLE :: ByteString -> Integer
bytesToIntegerLE bs = foldr (\(i, b) acc -> acc + (fromIntegral b `shiftL` (i * 8))) 0 
                      $ zip [0..] (BS.unpack bs)

-- | Derive signing key from Railgun spending key
-- Uses the SAME scalar derivation as getMasterPublicKeyPoint in Railgun.Keys:
-- scalar = bytesToIntegerLE(spendingKey) mod subgroupOrder
-- This ensures the public key matches what the circuit receives.
deriveSigningKey :: ByteString -> Maybe RailgunSigningKey
deriveSigningKey spendingKey = 
  let scalar = bytesToIntegerLE spendingKey `mod` BJJ.subgroupOrder
      pubKey = BJJ.scalarMultBase scalar
  in Just RailgunSigningKey
    { rskPrivateScalar = scalar
    , rskPublicKey = pubKey
    }

-- | Get the public key coordinates for circuit input
getSigningPublicKey :: RailgunSigningKey -> (Integer, Integer)
getSigningPublicKey rsk = 
  case rskPublicKey rsk of
    BJJ.Point x y -> (x, y)
    BJJ.Infinity -> (0, 1)

-- | Compute the message to sign for a Railgun transaction
-- This is the hash of the public inputs that the circuit will verify
computeSignatureMessage :: Integer   -- ^ Merkle root
                        -> Integer   -- ^ Bound params hash
                        -> [Integer] -- ^ Nullifiers
                        -> [Integer] -- ^ Output commitments
                        -> Integer
computeSignatureMessage merkleRoot boundParamsHash nullifiers commitments =
  -- Hash all the public inputs together using Poseidon
  -- This message will be verified in-circuit against the signature
  poseidonHash $ [merkleRoot, boundParamsHash] ++ nullifiers ++ commitments

-- | Sign transaction data using Poseidon-based EdDSA
-- Returns signature components (R8x, R8y, S) for circuit input
signTransactionData :: RailgunSigningKey
                    -> Integer  -- ^ Message to sign (computed from public inputs)
                    -> RailgunSignature
signTransactionData rsk message =
  let -- Use Poseidon-based signing with raw scalar (no hash/clamp)
      poseidonHashFn inputs = poseidonHash inputs
      sig = EdDSA.signPoseidonWithScalar poseidonHashFn (rskPrivateScalar rsk) message
      EdDSA.Signature rPoint s = sig
      (rx, ry) = case rPoint of
        BJJ.Point x y -> (x, y)
        BJJ.Infinity -> (0, 1)
  in RailgunSignature
    { rsR8x = rx
    , rsR8y = ry
    , rsS = s
    }
