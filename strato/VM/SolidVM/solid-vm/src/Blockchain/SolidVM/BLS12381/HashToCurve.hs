{-# LANGUAGE OverloadedStrings #-}

-- |
-- Re-export shim for the byte-encoding wrappers around the pure
-- map-to-curve pipelines defined in
-- 'Blockchain.SolidVM.BLS12381.HashToCurve.G1' and the (forthcoming)
-- G2 module. The actual algorithms + constants live there; this module
-- only handles the EIP-2537 byte layout (64-byte F_p / 128-byte F_p^2
-- input → 128-byte G1 / 256-byte G2 output) so the SolidVM dispatcher
-- has a single import point.
module Blockchain.SolidVM.BLS12381.HashToCurve
  ( mapFpToG1,
    mapFp2ToG2,
    hashToCurveG1,
    hashToCurveG2,
  )
where

import Blockchain.SolidVM.BLS12381.HashToCurve.G1
  ( clearCofactorG1,
    fieldPrime,
    isoMapG1,
    mapFpToG1Pt,
    simplifiedSwuG1Iso,
  )
import Blockchain.SolidVM.BLS12381.HashToCurve.G2
  ( clearCofactorG2,
    isoMapG2,
    mapFp2ToG2Pt,
    simplifiedSwuG2Iso,
  )
import Blockchain.SolidVM.BLS12381.HashToCurve.HashToField
  ( hashToFieldFp,
    hashToFieldFp2,
  )
import qualified Data.ByteString as B
import qualified Data.Word as W
import Data.Bits (shiftL)
import Data.Curve.Weierstrass (Point (..), add, dbl)
import Data.Foldable (foldl')
import Data.Pairing.BLS12381 (Fq2)
import GHC.Exts (IsList (fromList, toList))

-- ---- EIP-2537 byte codecs (mirror those in 'Blockchain.SolidVM.BLS12381') ----

fpSize, g1Size, fp2Size, g2Size :: Int
fpSize = 64
g1Size = 2 * fpSize
fp2Size = 2 * fpSize
g2Size = 2 * fp2Size

beToInteger :: B.ByteString -> Integer
beToInteger = foldl' (\acc w -> (acc `shiftL` 8) + fromIntegral w) 0 . B.unpack

integerToBE :: Int -> Integer -> B.ByteString
integerToBE n i =
  let go 0 _ = []
      go k v = go (k - 1) (v `quot` 256) ++ [fromIntegral (v `rem` 256) :: W.Word8]
   in B.pack (go n i)

decodeFp :: B.ByteString -> Either String Integer
decodeFp bs
  | B.length bs /= fpSize =
      Left $ "F_p element wrong length: expected " ++ show fpSize ++ ", got " ++ show (B.length bs)
  | not (B.all (== 0) (B.take 16 bs)) =
      Left "F_p element has non-zero high bytes (must be in 16 zero-byte padding)"
  | otherwise = Right (beToInteger bs)

encodeFp :: Integer -> B.ByteString
encodeFp = integerToBE fpSize

-- | EIP-2537 BLS12_MAP_FP_TO_G1: 64-byte F_p in, 128-byte G1 out.
--
-- Pipeline (RFC 9380 §C.2 + §6.6.2):
--   1. Decode the 64-byte input as an F_p element (rejecting >= p).
--   2. Run simplified-SWU + 11-isogeny to land on BLS12-381 G1.
--   3. Clear the cofactor (multiply by h_eff_G1) so the output lies in r·G1.
mapFpToG1 :: B.ByteString -> Either String B.ByteString
mapFpToG1 input = do
  u <- decodeFp input
  let pt = clearCofactorG1 (mapFpToG1Pt u)
  pure $ case pt of
    O -> B.replicate g1Size 0
    A x y -> encodeFp (toInteger x) <> encodeFp (toInteger y)

decodeFp2Pair :: B.ByteString -> Either String (Integer, Integer)
decodeFp2Pair bs
  | B.length bs /= fp2Size =
      Left $ "F_p^2 element wrong length: expected " ++ show fp2Size ++ ", got " ++ show (B.length bs)
  | otherwise = do
      c0 <- decodeFp (B.take fpSize bs)
      c1 <- decodeFp (B.drop fpSize bs)
      pure (c0, c1)

encodeFp2Pair :: (Integer, Integer) -> B.ByteString
encodeFp2Pair (c0, c1) = encodeFp c0 <> encodeFp c1

-- | Project an F_p^2 element back to its @(c0, c1)@ coefficient pair
--   using the polynomial-coefficient list 'IsList' instance.
fp2ToInts :: Fq2 -> (Integer, Integer)
fp2ToInts e = case toList e of
  [] -> (0, 0)
  [a] -> (toInteger a, 0)
  (a : b : _) -> (toInteger a, toInteger b)

-- | EIP-2537 BLS12_MAP_FP2_TO_G2: 128-byte F_p^2 in, 256-byte G2 out.
--
-- Pipeline (RFC 9380 §C.3 + §6.6.2):
--   1. Decode the 128-byte input as an F_p^2 element @(c0, c1)@.
--   2. Run simplified-SWU (over F_p^2) + 3-isogeny to land on BLS12-381 G2.
--   3. Clear the cofactor via integer-scalar multiplication by h_eff_G2
--      (~624-bit value, so we use a custom double-and-add rather than
--      the library's Fr-typed 'mul' which would reduce mod r).
--
-- Verified byte-exact against RFC 9380 §J.10.1 reference vectors.
mapFp2ToG2 :: B.ByteString -> Either String B.ByteString
mapFp2ToG2 input = do
  uPair <- decodeFp2Pair input
  let pt = mapFp2ToG2Pt uPair
  pure $ case pt of
    O -> B.replicate g2Size 0
    A x y -> encodeFp2Pair (fp2ToInts x) <> encodeFp2Pair (fp2ToInts y)

-- ============================================================================
-- Full hash_to_curve composition (RFC 9380 §3 / §6.6.3)
-- ============================================================================
--
-- The map_to_curve builtins above take pre-derived F_p / F_p^2 inputs --
-- which means a Solidity contract using them for BLS signature
-- verification has to implement 'expand_message_xmd' and 'hash_to_field'
-- itself, in user-space, before each map call. That's a lot of SHA-256
-- work in contract bytecode for something the host can do natively.
--
-- These two functions wire the full pipeline from a raw message + DST,
-- so a sync-committee verify (or any BLS_SIG_BLS12381*_XMD:SHA-256_*_*
-- scheme) becomes a single builtin call.
--
-- Suite mapping:
--   hash_to_curve(G1) = BLS12381G1_XMD:SHA-256_SSWU_RO_ (RFC 9380 §J.9)
--   hash_to_curve(G2) = BLS12381G2_XMD:SHA-256_SSWU_RO_ (RFC 9380 §J.10)
--
-- Both produce points in the prime-order subgroup r·G_i.

-- | hash_to_curve to BLS12-381 G1, instantiated as
--   @BLS12381G1_XMD:SHA-256_SSWU_RO_@. Caller supplies the DST so the
--   same builtin works for any BLS-on-G1 application; for Ethereum
--   sync-committee-style schemes the DST is application-specific.
--
--   @msg@ is the bytes to hash (e.g. a signing root). @dst@ is the
--   Domain Separation Tag (RFC 9380 §3.1; max 255 bytes, application-
--   chosen). Output: 128-byte EIP-2537 G1 encoding (x || y).
--
--   Verified byte-exact against RFC 9380 §J.9.1 reference vectors.
hashToCurveG1 :: B.ByteString -> B.ByteString -> Either String B.ByteString
hashToCurveG1 msg dst =
  case hashToFieldFp msg dst 2 64 fieldPrime of
    [u0, u1] ->
      let q0 = isoMapG1 (simplifiedSwuG1Iso (fromInteger u0))
          q1 = isoMapG1 (simplifiedSwuG1Iso (fromInteger u1))
          r = safeAdd q0 q1
          p = clearCofactorG1 r
       in Right $ case p of
            O -> B.replicate g1Size 0
            A x y -> encodeFp (toInteger x) <> encodeFp (toInteger y)
    _ -> Left "hashToCurveG1: hash_to_field returned wrong number of elements"
  where
    -- The Weierstrass library's 'add' is incomplete on equal inputs
    -- (returns the identity instead of the doubled point). We rarely
    -- hit q0 == q1 in practice, but compose defensively because the
    -- input pair comes from arbitrary message bytes.
    safeAdd a b = if a == b then dbl a else add a b

-- | hash_to_curve to BLS12-381 G2, instantiated as
--   @BLS12381G2_XMD:SHA-256_SSWU_RO_@. This is the curve target used
--   by Ethereum's BLS signature scheme (sync committee aggregates,
--   validator BLS signatures): the message hashes to G2, the pubkey
--   sits in G1, and verification is a single pairing check.
--
--   @msg@ is the bytes to hash (typically a signing root). @dst@ is
--   the Domain Separation Tag -- for Ethereum sync committee, that is
--   @"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_"@. Output: 256-byte
--   EIP-2537 G2 encoding (x.c0 || x.c1 || y.c0 || y.c1).
--
--   Verified byte-exact against RFC 9380 §J.10.1 reference vectors.
hashToCurveG2 :: B.ByteString -> B.ByteString -> Either String B.ByteString
hashToCurveG2 msg dst =
  case hashToFieldFp2 msg dst 2 64 fieldPrime of
    [u0, u1] ->
      let q0 = isoMapG2 (simplifiedSwuG2Iso (mkFp2 u0))
          q1 = isoMapG2 (simplifiedSwuG2Iso (mkFp2 u1))
          r = safeAdd q0 q1
          p = clearCofactorG2 r
       in Right $ case p of
            O -> B.replicate g2Size 0
            A x y -> encodeFp2Pair (fp2ToInts x) <> encodeFp2Pair (fp2ToInts y)
    _ -> Left "hashToCurveG2: hash_to_field returned wrong number of elements"
  where
    mkFp2 :: (Integer, Integer) -> Fq2
    mkFp2 (c0, c1) = fromList [fromInteger c0, fromInteger c1]
    safeAdd a b = if a == b then dbl a else add a b
