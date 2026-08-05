{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

-- |
-- BLS12-381 primitive operations for SolidVM, mirroring Ethereum's EIP-2537
-- precompile set so contracts can verify BLS aggregate signatures (sync
-- committee, threshold sigs, IBE) and operate over the curve directly.
--
-- The interface is intentionally byte-for-byte compatible with EIP-2537,
-- with one quirk: this module deals in raw 'ByteString' (the SolidVM
-- callBuiltin layer wraps it as @bytes@). Callers translating Solidity
-- code that uses the precompiles via @staticcall@ should be able to feed
-- the same input bytes here.
--
-- Encoding (per EIP-2537):
--
-- * Field elements F_p   = 64 bytes big-endian (16 zero-byte prefix + 48
--   bytes of the value, since |p| = 381 bits ≈ 48 bytes).
-- * Field elements F_p^2 = 128 bytes = c0 || c1, each c_i a 64-byte F_p.
-- * G1 points            = 128 bytes = x || y in F_p. Point at infinity is
--   the all-zero string.
-- * G2 points            = 256 bytes = x || y in F_p^2. Point at infinity
--   is the all-zero string.
-- * Scalars              = 32 bytes big-endian (the F_r scalar field is
--   ~255 bits, so 32 bytes is sufficient).
--
-- Functions return @Either String ByteString@ so the SolidVM dispatcher
-- can surface a clean error message via 'invalidArguments' rather than
-- letting a malformed input crash the VM.
--
-- Hash-to-curve (BLS12_MAP_FP_TO_G1 / BLS12_MAP_FP2_TO_G2 in EIP-2537) is
-- intentionally omitted here -- the standard simplified-SWU map (RFC 9380)
-- isn't provided directly by 'pairing-1.1.0' and warrants its own pass.
-- Bridge / signature flows that need 'H : msg -> G2' should compose
-- their own hash-to-field + map-to-curve on top of these primitives, or
-- wait for the follow-up that adds them as native builtins.
module Blockchain.SolidVM.BLS12381
  ( -- * Bytes-in / bytes-out variants (EIP-2537 byte layout)
    bls12381G1Add,
    bls12381G1Msm,
    bls12381G2Add,
    bls12381G2Msm,
    bls12381Pairing,

    -- * Multi-arg integer-tuple variants (SolidVM-native)
    --
    --   These take field elements as raw 'Integer's (Haskell's unbounded
    --   integers; SolidVM's @int@ lowers to this) and return tuples of
    --   the same. They're the natural shape for SolidVM contracts that
    --   want to feed coordinates directly without hand-encoding the
    --   EIP-2537 padded byte layout. The two forms produce the same
    --   group-theoretic answer; they differ only in how field elements
    --   cross the SolidVM/Haskell boundary.
    bls12381G1AddInts,
    bls12381G1MsmInts,
    bls12381G2AddInts,
    bls12381G2MsmInts,
    bls12381PairingInts,

    -- * Type aliases for the multi-arg layouts
    G1Coords,
    G2Coords,
    Fp2Coords,
  )
where

import Data.Bits (shiftL)
import qualified Data.ByteString as B
import Blockchain.VM.SolidException (invalidArguments)
import Data.Curve (Coordinates (Affine), Form (Weierstrass), mul')
import qualified Data.Curve.Weierstrass.BLS12381 as G1Curve
import qualified Data.Curve.Weierstrass.BLS12381T as G2Curve
import Data.Curve.Weierstrass (Point (..), add, dbl, mul)
import Data.Foldable (foldl')
import Data.Pairing (pairing)
import Data.Pairing.BLS12381 (Fq2)
import GHC.Exts (IsList (fromList, toList))
import qualified Data.Word as W

-- ============================================================================
-- Encoding constants
-- ============================================================================

-- | Bytes per F_p element (EIP-2537 padded layout).
fpSize :: Int
fpSize = 64

-- | Bytes per G1 point (x || y in F_p).
g1Size :: Int
g1Size = 2 * fpSize

-- | Bytes per F_p^2 element (c0 || c1, each c_i an F_p).
fp2Size :: Int
fp2Size = 2 * fpSize

-- | Bytes per G2 point (x || y in F_p^2).
g2Size :: Int
g2Size = 2 * fp2Size

-- | Bytes per scalar (32-byte big-endian, since F_r is ~255 bits).
scalarSize :: Int
scalarSize = 32

-- | A pairing input element: one G1 point followed by one G2 point.
pairSize :: Int
pairSize = g1Size + g2Size

-- | Bytes per (G1 point, scalar) pair in a G1MSM input.
g1MsmPairSize :: Int
g1MsmPairSize = g1Size + scalarSize

-- | Bytes per (G2 point, scalar) pair in a G2MSM input.
g2MsmPairSize :: Int
g2MsmPairSize = g2Size + scalarSize

-- ============================================================================
-- Big-endian byte <-> Integer helpers
-- ============================================================================

-- | Decode a big-endian byte string as a non-negative integer.
beToInteger :: B.ByteString -> Integer
beToInteger = foldl' (\acc w -> (acc `shiftL` 8) + fromIntegral w) 0 . B.unpack

-- | Encode an integer to a big-endian byte string of exactly @n@ bytes,
--   padding on the left with zeros. Errors if the integer overflows @n@
--   bytes (shouldn't happen for valid F_p / F_r / scalar values).
integerToBE :: Int -> Integer -> B.ByteString
integerToBE n i
  | i < 0 = error "integerToBE: negative integer"
  | otherwise =
      let bytes = collectBytes i
          padding = n - length bytes
       in if padding < 0
            then error "integerToBE: integer larger than requested width"
            else B.pack (replicate padding 0 ++ bytes)
  where
    collectBytes :: Integer -> [W.Word8]
    collectBytes 0 = []
    collectBytes v = collectBytes (v `quot` 256) ++ [fromIntegral (v `rem` 256)]

-- ============================================================================
-- F_p / F_p^2 codecs
-- ============================================================================

-- | The BLS12-381 base field modulus @p@ and subgroup order @r@.
bnP :: Integer
bnP = toInteger G1Curve._q

bnR :: Integer
bnR = toInteger G1Curve._r

-- | Decode a 64-byte F_p element. Validates the 16-byte zero prefix that
--   EIP-2537 mandates, and that the value is canonical (@< p@). The zero
--   prefix alone bounds the value to 384 bits while @p@ is only 381, so
--   without the second check a range of non-canonical encodings would be
--   silently reduced mod p by 'fromInteger' -- two distinct byte strings
--   mapping to one field element, which breaks the byte-exact EIP-2537
--   contract and admits malleable signature/proof encodings.
decodeFp :: B.ByteString -> Either String Integer
decodeFp bs
  | B.length bs /= fpSize =
      Left $ "F_p element wrong length: expected " ++ show fpSize ++ ", got " ++ show (B.length bs)
  | not (B.all (== 0) (B.take 16 bs)) =
      Left "F_p element has non-zero high bytes (must be in 16 zero-byte padding)"
  | v >= bnP = Left "F_p element is not canonical (must be < p)"
  | otherwise = Right v
  where
    v = beToInteger bs

-- | Encode an F_p element as 64 bytes (16-byte zero prefix + 48 bytes of value).
encodeFp :: Integer -> B.ByteString
encodeFp = integerToBE fpSize

-- | Decode an F_p^2 element (128 bytes = c0 || c1).
decodeFp2 :: B.ByteString -> Either String (Integer, Integer)
decodeFp2 bs
  | B.length bs /= fp2Size =
      Left $ "F_p^2 element wrong length: expected " ++ show fp2Size ++ ", got " ++ show (B.length bs)
  | otherwise = do
      c0 <- decodeFp (B.take fpSize bs)
      c1 <- decodeFp (B.drop fpSize bs)
      pure (c0, c1)

-- | Encode an F_p^2 element back as 128 bytes (c0 || c1).
encodeFp2 :: (Integer, Integer) -> B.ByteString
encodeFp2 (c0, c1) = encodeFp c0 <> encodeFp c1

-- | Build an F_p^2 element from two integer coefficients. The galois-field
--   library's 'IsList' instance for 'Extension' takes the coefficients in
--   ascending-degree order, so [c0, c1] = c0 + c1 * u.
mkFp2 :: Integer -> Integer -> Fq2
mkFp2 c0 c1 = fromList [fromInteger c0, fromInteger c1]

-- | Extract the two integer coefficients of an F_p^2 element. The
--   underlying polynomial may have fewer than two terms (e.g. @0@ stored
--   as the empty polynomial); right-pad with zeros to keep the layout
--   stable for byte encoding.
fromFp2 :: Fq2 -> (Integer, Integer)
fromFp2 e = case toList e of
  [] -> (0, 0)
  [c0] -> (toInteger c0, 0)
  (c0 : c1 : _) -> (toInteger c0, toInteger c1)

-- | Decode a 32-byte big-endian scalar. The scalar field F_r is ~255 bits,
--   so 32 bytes is sufficient; the curve library reduces mod r internally.
decodeScalar :: B.ByteString -> Either String Integer
decodeScalar bs
  | B.length bs /= scalarSize =
      Left $ "Scalar wrong length: expected " ++ show scalarSize ++ ", got " ++ show (B.length bs)
  | otherwise = Right (beToInteger bs)

-- ============================================================================
-- G1 codec (BLS12-381 over F_p)
-- ============================================================================

-- | The G1 point type from the elliptic-curve library. The 'Point' newtype
--   is parameterized by curve form (Weierstrass), coordinate representation
--   (Affine), curve marker, base field, and scalar field. Both the curve
--   and its twist share the same 'BLS12381' marker -- they're distinguished
--   by the field argument (Fq for G1, Fq2 for G2).
type G1 = Point Weierstrass Affine G1Curve.BLS12381 G1Curve.Fq G1Curve.Fr

-- | Decode a 128-byte G1 point (x || y). The all-zero string decodes as
--   the point at infinity, matching EIP-2537 convention. Any other point
--   must lie on the curve; non-curve points are rejected.
decodeG1 :: B.ByteString -> Either String G1
decodeG1 bs
  | B.length bs /= g1Size =
      Left $ "G1 point wrong length: expected " ++ show g1Size ++ ", got " ++ show (B.length bs)
  | B.all (== 0) bs = Right O -- point at infinity
  | otherwise = do
      x <- decodeFp (B.take fpSize bs)
      y <- decodeFp (B.drop fpSize bs)
      let p = A (fromInteger x :: G1Curve.Fq) (fromInteger y :: G1Curve.Fq)
      -- Reject off-curve points explicitly so misuse is a loud error
      -- rather than a silent pairing-equation hole.
      if not (onCurveG1 p)
        then Left "G1 point is not on the curve"
        else
          if not (inSubgroupG1 p)
            then Left "G1 point is not in the r-order subgroup"
            else Right p

-- | Curve-membership check for G1. Encodes the affine equation y^2 = x^3 + b.
--   We compare in the field rather than relying on the library's typeclass
--   so the failure mode is a clean Either rather than an exception.
onCurveG1 :: G1 -> Bool
onCurveG1 O = True
onCurveG1 (A x y) = y * y == x * x * x + G1Curve._b

-- | Subgroup membership for G1: @[r]P == O@.
--
--   Unlike BN254, BLS12-381's G1 has a large cofactor
--   (h ≈ 2^126), so an on-curve point need not be in the r-order
--   subgroup. EIP-2537 mandates this check on every MSM and pairing
--   input: pairing a non-subgroup point can satisfy a verifier's pairing
--   equation with a forged aggregate signature or KZG opening.
--
--   This is the straightforward @[r]P@ test. Faster endomorphism-based
--   checks exist (Bowe / Scott) and are worth revisiting alongside the
--   pairing final-exponentiation work if subgroup checks show up hot.
inSubgroupG1 :: G1 -> Bool
inSubgroupG1 O = True
inSubgroupG1 p = mul' p bnR == O

-- | Encode a G1 point as 128 bytes (x || y). Point at infinity becomes
--   the all-zero string.
encodeG1 :: G1 -> B.ByteString
encodeG1 O = B.replicate g1Size 0
encodeG1 (A x y) = encodeFp (toInteger x) <> encodeFp (toInteger y)

-- ============================================================================
-- G2 codec (BLS12-381 twist over F_p^2)
-- ============================================================================

type G2 = Point Weierstrass Affine G1Curve.BLS12381 Fq2 G1Curve.Fr

-- | Decode a 256-byte G2 point (x || y, each in F_p^2 = 128 bytes).
decodeG2 :: B.ByteString -> Either String G2
decodeG2 bs
  | B.length bs /= g2Size =
      Left $ "G2 point wrong length: expected " ++ show g2Size ++ ", got " ++ show (B.length bs)
  | B.all (== 0) bs = Right O
  | otherwise = do
      (xc0, xc1) <- decodeFp2 (B.take fp2Size bs)
      (yc0, yc1) <- decodeFp2 (B.drop fp2Size bs)
      let p = A (mkFp2 xc0 xc1) (mkFp2 yc0 yc1)
      if not (onCurveG2 p)
        then Left "G2 point is not on the curve"
        else
          if not (inSubgroupG2 p)
            then Left "G2 point is not in the r-order subgroup"
            else Right p

-- | Curve-membership check for G2. The twist's b coefficient lives in
--   F_p^2; same equation as G1 but with the extension-field arithmetic.
onCurveG2 :: G2 -> Bool
onCurveG2 O = True
onCurveG2 (A x y) = y * y == x * x * x + G2Curve._b

-- | Subgroup membership for G2: @[r]P == O@. The twist's cofactor is
--   ~509 bits, so on-curve is very far from sufficient here.
inSubgroupG2 :: G2 -> Bool
inSubgroupG2 O = True
inSubgroupG2 p = mul' p bnR == O

-- | Encode a G2 point as 256 bytes.
encodeG2 :: G2 -> B.ByteString
encodeG2 O = B.replicate g2Size 0
encodeG2 (A x y) = encodeFp2 (fromFp2 x) <> encodeFp2 (fromFp2 y)

-- ============================================================================
-- Public API: EIP-2537-shaped operations
-- ============================================================================

-- | Sum two same-curve points, dispatching to 'dbl' when they're equal.
--   The library's affine 'add' formula divides by @x1 - x2@ and returns
--   the point at infinity for the doubling case; EIP-2537 mandates the
--   well-defined @2P@ result, so we route around it.
--
--   The G1 / G2 monomorphic wrappers below avoid the @Eq q@ /
--   @WACurve e q r@ constraint plumbing that a polymorphic version of
--   this helper would drag through call sites; the only callers that
--   matter are 'bls12381G1Add' / 'bls12381G2Add' and the MSM accumulators,
--   so two specializations are clearer than one polymorphic one.
safeAddG1 :: G1 -> G1 -> G1
safeAddG1 p1 p2
  | p1 == p2 = dbl p1
  | otherwise = add p1 p2

safeAddG2 :: G2 -> G2 -> G2
safeAddG2 p1 p2
  | p1 == p2 = dbl p1
  | otherwise = add p1 p2

-- | G1ADD: add two G1 points. Input is 256 bytes (two 128-byte G1 points),
--   output is 128 bytes.
bls12381G1Add :: B.ByteString -> Either String B.ByteString
bls12381G1Add input
  | B.length input /= 2 * g1Size =
      Left $ "bls12381G1Add: expected " ++ show (2 * g1Size) ++ " bytes, got " ++ show (B.length input)
  | otherwise = do
      p1 <- decodeG1 (B.take g1Size input)
      p2 <- decodeG1 (B.drop g1Size input)
      pure . encodeG1 $ safeAddG1 p1 p2

-- | G1MSM: multi-scalar multiplication on G1, computing @Σ_i kᵢ · Pᵢ@.
--   Input is @k * 160@ bytes (each 160-byte chunk is a 128-byte G1 point
--   followed by a 32-byte big-endian scalar). Output is 128 bytes.
--   Empty input is rejected -- EIP-2537's gas formula assumes k ≥ 1, and
--   the "empty MSM is the point at infinity" convention has historically
--   been a foot-gun in cross-implementation tests, so we match the spec
--   conservatively and error.
bls12381G1Msm :: B.ByteString -> Either String B.ByteString
bls12381G1Msm input
  | B.null input =
      Left "bls12381G1Msm: empty input"
  | B.length input `mod` g1MsmPairSize /= 0 =
      Left $
        "bls12381G1Msm: input length must be a multiple of " ++ show g1MsmPairSize
          ++ ", got " ++ show (B.length input)
  | otherwise = encodeG1 <$> g1MsmAcc O input
  where
    g1MsmAcc :: G1 -> B.ByteString -> Either String G1
    g1MsmAcc acc bs
      | B.null bs = Right acc
      | otherwise = do
          let (chunk, rest) = B.splitAt g1MsmPairSize bs
          p <- decodeG1 (B.take g1Size chunk)
          s <- decodeScalar (B.drop g1Size chunk)
          let term = mul p (fromInteger s :: G1Curve.Fr)
          g1MsmAcc (safeAddG1 acc term) rest

-- | G2ADD: add two G2 points. Input is 512 bytes, output is 256 bytes.
bls12381G2Add :: B.ByteString -> Either String B.ByteString
bls12381G2Add input
  | B.length input /= 2 * g2Size =
      Left $ "bls12381G2Add: expected " ++ show (2 * g2Size) ++ " bytes, got " ++ show (B.length input)
  | otherwise = do
      p1 <- decodeG2 (B.take g2Size input)
      p2 <- decodeG2 (B.drop g2Size input)
      pure . encodeG2 $ safeAddG2 p1 p2

-- | G2MSM: multi-scalar multiplication on G2, computing @Σ_i kᵢ · Pᵢ@.
--   Input is @k * 288@ bytes (each 288-byte chunk is a 256-byte G2 point
--   followed by a 32-byte scalar). Output is 256 bytes.
bls12381G2Msm :: B.ByteString -> Either String B.ByteString
bls12381G2Msm input
  | B.null input =
      Left "bls12381G2Msm: empty input"
  | B.length input `mod` g2MsmPairSize /= 0 =
      Left $
        "bls12381G2Msm: input length must be a multiple of " ++ show g2MsmPairSize
          ++ ", got " ++ show (B.length input)
  | otherwise = encodeG2 <$> g2MsmAcc O input
  where
    g2MsmAcc :: G2 -> B.ByteString -> Either String G2
    g2MsmAcc acc bs
      | B.null bs = Right acc
      | otherwise = do
          let (chunk, rest) = B.splitAt g2MsmPairSize bs
          p <- decodeG2 (B.take g2Size chunk)
          s <- decodeScalar (B.drop g2Size chunk)
          let term = mul p (fromInteger s :: G1Curve.Fr)
          g2MsmAcc (safeAddG2 acc term) rest

-- | PAIRING_CHECK: given k pairs (G1_i, G2_i), return whether
--   ∏ e(G1_i, G2_i) = 1_GT. Input must be a multiple of 384 bytes;
--   each 384-byte block is one (G1, G2) pair. Returns @True@ when the
--   pairing product is the identity in GT, matching EIP-2537's "result
--   is 32 bytes of all-ones if equal else all-zeros" semantics (the
--   SolidVM dispatcher wraps the Bool back to a 32-byte word).
bls12381Pairing :: B.ByteString -> Either String Bool
bls12381Pairing input
  | B.null input =
      -- Empty product is the identity element by convention.
      Right True
  | B.length input `mod` pairSize /= 0 =
      Left $
        "bls12381Pairing: input length must be a multiple of " ++ show pairSize
          ++ ", got " ++ show (B.length input)
  | otherwise = do
      pairs <- decodePairs input
      let products = [pairing p1 p2 | (p1, p2) <- pairs]
      -- mconcat over GT' uses the multiplicative identity (1_GT) as mempty,
      -- so an empty product (filtered by the null check above) returns True.
      pure $ mconcat products == mempty
  where
    decodePairs :: B.ByteString -> Either String [(G1, G2)]
    decodePairs bs
      | B.null bs = Right []
      | otherwise = do
          let (chunk, rest) = B.splitAt pairSize bs
          p1 <- decodeG1 (B.take g1Size chunk)
          p2 <- decodeG2 (B.drop g1Size chunk)
          ((p1, p2) :) <$> decodePairs rest

-- ============================================================================
-- Multi-arg integer-tuple API (SolidVM-native)
-- ============================================================================
--
-- The functions below take field-element coordinates as 'Integer' (matching
-- SolidVM's unbounded integer values) and return tuples of the same. They
-- skip the EIP-2537 byte-padding step entirely, which is more ergonomic
-- when SolidVM contracts compose precompile calls without leaving the
-- integer domain. The point at infinity is encoded as the all-zero tuple.

-- | A G1 point as @(x, y)@ in F_p, with @(0, 0)@ representing the point at
--   infinity. Identical to BN254 'ecAdd' / 'ecMul' result shape.
type G1Coords = (Integer, Integer)

-- | An F_p^2 element as @(c0, c1)@ where the value is @c0 + c1·u@.
type Fp2Coords = (Integer, Integer)

-- | A G2 point as @((x_c0, x_c1), (y_c0, y_c1))@. The all-zeros nested
--   tuple is the point at infinity.
type G2Coords = (Fp2Coords, Fp2Coords)

-- ---- Integer <-> point conversions ----

-- | The integer-tuple entry points get the same validation as the byte
--   decoders -- canonical coordinates, on-curve, and in the r-order
--   subgroup. They are the shape SolidVM contracts reach for most often,
--   so leaving them unchecked would route around every guarantee the
--   bytes API provides. Failures throw 'invalidArguments' (rather than
--   returning 'Either') to match the BN254 'ecAdd' / 'ecMul' convention:
--   an invalid point reverts the transaction.
outOfRange :: Integer -> Bool
outOfRange c = c < 0 || c >= bnP

g1FromInts :: G1Coords -> G1
g1FromInts (0, 0) = O
g1FromInts (x, y)
  | outOfRange x || outOfRange y =
      invalidArguments "bls12381" $ "G1 coordinate out of range [0, p): " ++ show (x, y)
  | not (onCurveG1 p) =
      invalidArguments "bls12381" $ "G1 point is not on the curve: " ++ show (x, y)
  | not (inSubgroupG1 p) =
      invalidArguments "bls12381" $ "G1 point is not in the r-order subgroup: " ++ show (x, y)
  | otherwise = p
  where
    p = A (fromInteger x :: G1Curve.Fq) (fromInteger y :: G1Curve.Fq)

g1ToInts :: G1 -> G1Coords
g1ToInts O = (0, 0)
g1ToInts (A x y) = (toInteger x, toInteger y)

g2FromInts :: G2Coords -> G2
g2FromInts ((0, 0), (0, 0)) = O
g2FromInts coords@((xc0, xc1), (yc0, yc1))
  | any outOfRange [xc0, xc1, yc0, yc1] =
      invalidArguments "bls12381" $ "G2 coordinate out of range [0, p): " ++ show coords
  | not (onCurveG2 p) =
      invalidArguments "bls12381" $ "G2 point is not on the twist curve: " ++ show coords
  | not (inSubgroupG2 p) =
      invalidArguments "bls12381" $ "G2 point is not in the r-order subgroup: " ++ show coords
  | otherwise = p
  where
    p = A (mkFp2 xc0 xc1) (mkFp2 yc0 yc1)

g2ToInts :: G2 -> G2Coords
g2ToInts O = ((0, 0), (0, 0))
g2ToInts (A x y) = (fromFp2 x, fromFp2 y)

-- ---- Public API ----

-- | G1ADD over integer tuples. @(x1, y1) + (x2, y2)@.
bls12381G1AddInts :: G1Coords -> G1Coords -> G1Coords
bls12381G1AddInts a b = g1ToInts $ safeAddG1 (g1FromInts a) (g1FromInts b)

-- | G1MSM over integer tuples: each input is @(x, y, k)@, computes
--   @Σᵢ kᵢ · (xᵢ, yᵢ)@. An empty list returns the point at infinity --
--   contrast with the bytes form, which rejects empty input. Callers in
--   the SolidVM dispatcher already enforce the non-empty constraint at
--   the typechecker level (variadic with at least one arg), so the
--   permissive convention here keeps the pure function simple.
bls12381G1MsmInts :: [(Integer, Integer, Integer)] -> G1Coords
bls12381G1MsmInts =
  g1ToInts
    . foldl
      ( \acc (x, y, k) ->
          let term = mul (g1FromInts (x, y)) (fromInteger k :: G1Curve.Fr)
           in safeAddG1 acc term
      )
      O

-- | G2ADD over integer tuples.
bls12381G2AddInts :: G2Coords -> G2Coords -> G2Coords
bls12381G2AddInts a b = g2ToInts $ safeAddG2 (g2FromInts a) (g2FromInts b)

-- | G2MSM over integer tuples: each input is @(point, k)@.
bls12381G2MsmInts :: [(G2Coords, Integer)] -> G2Coords
bls12381G2MsmInts =
  g2ToInts
    . foldl
      ( \acc (pt, k) ->
          let term = mul (g2FromInts pt) (fromInteger k :: G1Curve.Fr)
           in safeAddG2 acc term
      )
      O

-- | PAIRING_CHECK over integer tuples. Each input is @(g1, g2)@; returns
--   whether @∏ e(g1ᵢ, g2ᵢ) = 1_GT@. Empty input is the identity (True).
bls12381PairingInts :: [(G1Coords, G2Coords)] -> Bool
bls12381PairingInts pairs =
  let products = [pairing (g1FromInts a) (g2FromInts b) | (a, b) <- pairs]
   in mconcat products == mempty
