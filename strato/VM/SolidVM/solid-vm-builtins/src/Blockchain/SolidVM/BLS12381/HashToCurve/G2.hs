{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

-- |
-- RFC 9380 hash-to-curve pipeline for BLS12-381 G2.
--
-- Same three-stage shape as 'Blockchain.SolidVM.BLS12381.HashToCurve.G1':
--
--   1. 'simplifiedSwuG2Iso' — simplified-SWU map onto the isogenous
--      twist E'_iso2 over F_p^2.
--   2. 'isoMapG2' — 3-isogeny back to BLS12-381 G2.
--   3. 'clearCofactorG2' — multiply by h_eff_G2 (a 624-bit value) to
--      land in r·G2.
--
-- Constants from RFC 9380 §E.3 / §F.3. Fp2 sqrt uses the standard
-- two-Fp-sqrt decomposition (sqrt(a + b·u) reduces to two square roots
-- in F_p when p ≡ 3 mod 4); the elliptic-curve library's Group instance
-- for G2 doesn't expose a 'mul' that takes integer scalars larger than
-- r, so 'mulIntegerG2' walks the bits manually.
--
-- Verified byte-exact against RFC 9380 §J.10.1 reference vector for
-- @msg = ""@ via the test suite's hash_to_curve composition.
module Blockchain.SolidVM.BLS12381.HashToCurve.G2
  ( -- * Public entry point
    mapFp2ToG2Pt,

    -- * Pipeline stages (exposed for testing)
    simplifiedSwuG2Iso,
    isoMapG2,
    clearCofactorG2,

    -- * Useful constants for verification
    g2IsoA,
    g2IsoB,

    -- * F_p^2 primitives (used by the compression / decompression module)
    mkFp2,
    fp2Pair,
    sqrtFp2,
    isSquareFp2,
  )
where

import Data.Bits (testBit)
import Data.Curve (Coordinates (Affine), Form (Weierstrass))
import qualified Data.Curve.Weierstrass as W
import qualified Data.Curve.Weierstrass.BLS12381 as G1Curve
import Data.Curve.Weierstrass (Point (..), add, dbl)
import Data.Pairing.BLS12381 (Fq2)
import GHC.Exts (IsList (fromList, toList))

-- ============================================================================
-- Type aliases and field-level helpers
-- ============================================================================

type Fp = G1Curve.Fq

type Fr = G1Curve.Fr

type G2 = Point Weierstrass Affine G1Curve.BLS12381 Fq2 Fr

fieldPrime :: Integer
fieldPrime = toInteger (W.q_ (W.gA_ :: W.WAPoint G1Curve.BLS12381 Fp Fr))

fieldPrimePlus1Div4 :: Integer
fieldPrimePlus1Div4 = (fieldPrime + 1) `div` 4

fieldPrimeMinus1Div2 :: Integer
fieldPrimeMinus1Div2 = (fieldPrime - 1) `div` 2

-- | F_p sqrt for p ≡ 3 (mod 4): @x^((p+1)/4)@.
sqrtFp :: Fp -> Fp
sqrtFp x = x ^ fieldPrimePlus1Div4

-- | F_p QR test via Euler's criterion.
isSquareFp :: Fp -> Bool
isSquareFp x =
  let r = x ^ fieldPrimeMinus1Div2
   in r == 0 || r == 1

-- ============================================================================
-- F_p^2 helpers
-- ============================================================================

-- | F_p^2 element @c0 + c1·u@ from integer coefficients.
mkFp2 :: Integer -> Integer -> Fq2
mkFp2 c0 c1 = fromList [fromInteger c0, fromInteger c1]

-- | Project an F_p^2 element back to its @(c0, c1)@ coefficient pair.
fp2Pair :: Fq2 -> (Fp, Fp)
fp2Pair e = case toList e of
  [] -> (0, 0)
  [c0] -> (c0, 0)
  (c0 : c1 : _) -> (c0, c1)

-- | RFC 9380 §4.1 sgn0 for F_p^2 (m = 2):
--   @sgn0(c0 + c1·u) = sgn0(c0) OR (c0 == 0 AND sgn0(c1))@.
sgn0Fp2 :: Fq2 -> Int
sgn0Fp2 e =
  let (c0, c1) = fp2Pair e
      s0 = if testBit (toInteger c0) 0 then 1 :: Int else 0
      z0 = if c0 == 0 then 1 :: Int else 0
      s1 = if testBit (toInteger c1) 0 then 1 :: Int else 0
   in orInt s0 (andInt z0 s1)
  where
    orInt :: Int -> Int -> Int
    orInt a b = if a == 1 || b == 1 then 1 else 0
    andInt :: Int -> Int -> Int
    andInt a b = if a == 1 && b == 1 then 1 else 0

-- | F_p^2 quadratic-residue test. Equivalent to @v^((p^2-1)/2) ∈ {0, 1}@,
--   but cheaper: @v@ is a QR in F_p^2 iff @norm(v) = c0² + c1²@ is a QR
--   in F_p (using the F_p[u]/(u²+1) structure). Saves one ~762-bit
--   exponentiation per call.
isSquareFp2 :: Fq2 -> Bool
isSquareFp2 e =
  let (c0, c1) = fp2Pair e
      n = c0 * c0 + c1 * c1
   in n == 0 || isSquareFp n

-- | F_p^2 inverse with 'inv0' convention (0 → 0). Same shape as the F_p
--   variant in the G1 module; reproduced here so this module is
--   self-contained.
inv0Fp2 :: Fq2 -> Fq2
inv0Fp2 v = if v == mkFp2 0 0 then mkFp2 0 0 else recip v

-- | Sqrt in F_p^2 when p ≡ 3 (mod 4). Uses the decomposition
--
--   For @v = a + b·u@ with @b ≠ 0@: any sqrt @x + y·u@ satisfies
--   @x² - y² = a@ and @2xy = b@. Hence @(x² + y²)² = a² + b² = norm(v)@,
--   so @x² + y² = ±sqrt(norm(v))@. Picking the sign so @(a + s)/2@ is
--   a QR in F_p, we get @x = sqrt((a + s)/2)@ and @y = b / (2x)@.
--
--   For pure-real (b = 0): sqrt(a) lives in F_p iff a is a QR there;
--   else we use the imaginary axis: sqrt(a) = sqrt(-a)·u.
--
--   Caller must guard with 'isSquareFp2'; we don't double-check.
sqrtFp2 :: Fq2 -> Fq2
sqrtFp2 v =
  let (a, b) = fp2Pair v
   in if b == 0
        then
          if isSquareFp a
            then mkFp2 (toInteger (sqrtFp a)) 0
            else mkFp2 0 (toInteger (sqrtFp (negate a)))
        else
          let n = a * a + b * b
              s = sqrtFp n
              cand1 = (a + s) / 2
              x =
                if isSquareFp cand1
                  then sqrtFp cand1
                  else sqrtFp ((a - s) / 2)
              y = b / (x + x)
           in mkFp2 (toInteger x) (toInteger y)

-- ============================================================================
-- E'_iso2 curve constants (RFC 9380 §E.3)
-- ============================================================================

-- | A' = 0 + 240·u
g2IsoA :: Fq2
g2IsoA = mkFp2 0 240

-- | B' = 1012 + 1012·u
g2IsoB :: Fq2
g2IsoB = mkFp2 1012 1012

-- | Z = -2 - u (i.e. (p-2) + (p-1)·u in canonical form).
g2IsoZ :: Fq2
g2IsoZ = mkFp2 (fieldPrime - 2) (fieldPrime - 1)

-- | h_eff_G2 from RFC 9380 §8.8.2. ~624-bit cofactor multiplier.
g2Heff :: Integer
g2Heff =
  0xbc69f08f2ee75b3584c6a0ea91b352888e2a8e9145ad7689986ff031508ffe1329c2f178731db956d82bf015d1212b02ec0ec69d7477c1ae954cbc06689f6a359894c0adebbf6b4e8020005aaa95551

-- ============================================================================
-- 3-isogeny coefficients (RFC 9380 §E.3)
-- ============================================================================

-- Each coefficient is an F_p^2 element @(c0, c1)@. Polynomials are in
-- 'x' alone, in ascending-degree order (k_(i, 0) first).

g2IsoXnumCoeffs :: [(Integer, Integer)]
g2IsoXnumCoeffs =
  [ ( 0x05c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6,
      0x05c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6
    ),
    ( 0,
      0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71a
    ),
    ( 0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71e,
      0x08ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38d
    ),
    ( 0x171d6541fa38ccfaed6dea691f5fb614cb14b4e7f4e810aa22d6108f142b85757098e38d0f671c7188e2aaaaaaaa5ed1,
      0
    )
  ]

-- | k_(2, 0) = (0, p - 0x48); k_(2, 1) = (0xc, p - 0xc); leading x² implicit.
--   Verified per RFC 9380 §E.3 — p - 0x48 = ...aa63, p - 0xc = ...aa9f.
g2IsoXdenCoeffs :: [(Integer, Integer)]
g2IsoXdenCoeffs =
  [ ( 0,
      0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa63 -- p - 0x48
    ),
    ( 0xc,
      0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa9f -- p - 0xc
    )
    -- monic degree-2 (implicit leading x²)
  ]

g2IsoYnumCoeffs :: [(Integer, Integer)]
g2IsoYnumCoeffs =
  [ ( 0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706,
      0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706
    ),
    ( 0,
      0x05c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97be
    ),
    ( 0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71c,
      0x08ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38f
    ),
    ( 0x124c9ad43b6cf79bfbf7043de3811ad0761b0f37a1e26286b0e977c69aa274524e79097a56dc4bd9e1b371c71c718b10,
      0
    )
  ]

-- | k_(4, 0) = (p - 0x1b0, p - 0x1b0); k_(4, 1) = (0, p - 0xd8);
--   k_(4, 2) = (0x12, p - 0x12). All three Fp2 constants are listed in
--   RFC 9380 §E.3 verbatim; p - 0x1b0 = ...a8fb, p - 0xd8 = ...a9d3,
--   p - 0x12 = ...aa99.
g2IsoYdenCoeffs :: [(Integer, Integer)]
g2IsoYdenCoeffs =
  [ ( 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb, -- p - 0x1b0
      0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb -- p - 0x1b0
    ),
    ( 0,
      0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa9d3 -- p - 0xd8
    ),
    ( 0x12,
      0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa99 -- p - 0x12
    )
    -- monic degree-3 (implicit leading x³)
  ]

-- ============================================================================
-- Stage 1: simplified-SWU on E'_iso2
-- ============================================================================

simplifiedSwuG2Iso :: Fq2 -> (Fq2, Fq2)
simplifiedSwuG2Iso u =
  let zU2 = g2IsoZ * u * u
      zU2Sq = zU2 * zU2
      tv1 = inv0Fp2 (zU2Sq + zU2)
      x1 =
        if tv1 == mkFp2 0 0
          then g2IsoB / (g2IsoZ * g2IsoA)
          else negate (g2IsoB / g2IsoA) * (mkFp2 1 0 + tv1)
      gx1 = x1 * x1 * x1 + g2IsoA * x1 + g2IsoB
      x2 = zU2 * x1
      gx2 = x2 * x2 * x2 + g2IsoA * x2 + g2IsoB
      (x, yC) =
        if isSquareFp2 gx1
          then (x1, sqrtFp2 gx1)
          else (x2, sqrtFp2 gx2)
      y = if sgn0Fp2 u == sgn0Fp2 yC then yC else negate yC
   in (x, y)

-- ============================================================================
-- Stage 2: 3-isogeny back to G2
-- ============================================================================

hornerFp2 :: [Fq2] -> Fq2 -> Fq2
hornerFp2 coeffs x = foldr (\c acc -> acc * x + c) (mkFp2 0 0) coeffs

hornerMonicFp2 :: [Fq2] -> Fq2 -> Fq2
hornerMonicFp2 coeffs x =
  let n = length coeffs
   in hornerFp2 coeffs x + x ^ n

isoMapG2 :: (Fq2, Fq2) -> G2
isoMapG2 (x, y) =
  let toF = map (\(c0, c1) -> mkFp2 c0 c1)
      xnum = hornerFp2 (toF g2IsoXnumCoeffs) x
      xden = hornerMonicFp2 (toF g2IsoXdenCoeffs) x
      ynum = hornerFp2 (toF g2IsoYnumCoeffs) x
      yden = hornerMonicFp2 (toF g2IsoYdenCoeffs) x
   in if xden == mkFp2 0 0 || yden == mkFp2 0 0
        then O
        else A (xnum / xden) (y * (ynum / yden))

-- ============================================================================
-- Stage 3: cofactor clearing
-- ============================================================================

-- | Same doubling-aware add helper as G1, specialized to G2.
safeAddG2 :: G2 -> G2 -> G2
safeAddG2 p q = if p == q then dbl p else add p q

-- | Multiply a G2 point by an arbitrary 'Integer' scalar via
--   double-and-add. We can't use the library's 'mul' here because it
--   takes the scalar through 'Fr' (mod r), and h_eff_G2 is much larger
--   than r — reducing it mod r would compute the wrong cofactor for
--   points that aren't already in r·G2 (which is precisely the
--   pre-cofactor-clearing case).
mulIntegerG2 :: Integer -> G2 -> G2
mulIntegerG2 0 _ = O
mulIntegerG2 n0 p0 = go (abs n0) p0 O
  where
    go 0 _ acc = if n0 < 0 then W.inv acc else acc
    go k base acc =
      let acc' = if odd k then safeAddG2 acc base else acc
          base' = dbl base
       in go (k `quot` 2) base' acc'

-- | Multiply by h_eff_G2 to land the point in r·G2.
clearCofactorG2 :: G2 -> G2
clearCofactorG2 = mulIntegerG2 g2Heff

-- ============================================================================
-- Public entry point
-- ============================================================================

-- | EIP-2537 BLS12_MAP_FP2_TO_G2: given an F_p^2 input @(c0, c1)@,
--   run simplified-SWU + 3-isogeny + cofactor clearing and return a
--   point in r·G2.
mapFp2ToG2Pt :: (Integer, Integer) -> G2
mapFp2ToG2Pt (c0, c1) =
  let u = mkFp2 c0 c1
      (xIso, yIso) = simplifiedSwuG2Iso u
      pE = isoMapG2 (xIso, yIso)
   in clearCofactorG2 pE
