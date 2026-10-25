{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

-- |
-- RFC 9380 hash-to-curve pipeline for BLS12-381 G1.
--
-- Three stages:
--
--   1. 'simplifiedSwuG1Iso' — simplified-SWU map (RFC 9380 §6.6.2,
--      case @q ≡ 3 (mod 4)@) onto the isogenous curve E'_iso. The
--      iso curve has nonzero 'A' so the SWU formulas don't degenerate.
--
--   2. 'isoMapG1' — 11-isogeny back to BLS12-381 G1 (E: y² = x³ + 4),
--      defined by four polynomials in @x@ alone (RFC 9380 §E.2 /
--      §C.2). Coefficients sourced from RFC 9380 Appendix E.2.
--
--   3. 'clearCofactorG1' — multiply by h_eff_G1 = 1 - z (where
--      @z = -0xd201000000010000@ is the BLS curve parameter) so the
--      output lands in r·G1 ⊂ E.
--
-- We derive the field prime from the elliptic-curve library directly
-- (via 'q_' on a curve point) rather than transcribing it manually,
-- which eliminates one whole class of constant-typo bug. Iso
-- coefficients are still hand-transcribed from RFC 9380 §E.2; the
-- end-to-end test against §J.9.1 reference vectors is what catches
-- any remaining typos.
--
-- == Verification
--
-- Cross-checked byte-exact against RFC 9380 §J.9.1 reference vectors
-- (msgs @""@, @"abc"@, @"abcdef0123456789"@) end-to-end: the test
-- suite drives hash_to_curve from each message string via
-- 'Blockchain.SolidVM.BLS12381.HashToCurve.HashToField.hashToFieldFp'
-- and compares the final P to the RFC's published value. Matching at
-- this level means every isogeny coefficient, the simplified-SWU
-- formula, and the cofactor multiplication are all correct.
module Blockchain.SolidVM.BLS12381.HashToCurve.G1
  ( -- * Public entry point
    mapFpToG1Pt,

    -- * Pipeline stages (exposed for testing against RFC reference vectors)
    simplifiedSwuG1Iso,
    isoMapG1,
    clearCofactorG1,

    -- * Constants useful for verification tests
    fieldPrime,
    fieldPrimeMinus1Div2,
    g1IsoA,
    g1IsoB,

    -- * Field primitives (used by the compression / decompression module)
    Fp,
    sqrtFp,
    isSquareFp,
  )
where

import Data.Bits (testBit)
import Data.Curve (Coordinates (Affine), Form (Weierstrass))
import qualified Data.Curve.Weierstrass as W
import qualified Data.Curve.Weierstrass.BLS12381 as G1Curve
import Data.Curve.Weierstrass (Point (..), mul)

-- ============================================================================
-- Type aliases
-- ============================================================================

type Fp = G1Curve.Fq

type Fr = G1Curve.Fr

type G1 = Point Weierstrass Affine G1Curve.BLS12381 Fp Fr

-- ============================================================================
-- Field prime (derived, not transcribed)
-- ============================================================================

-- | BLS12-381 base prime p. Derived from the curve library via the
--   'WCurve.q_' typeclass method so we never get out of sync with the
--   library's modular arithmetic.
fieldPrime :: Integer
fieldPrime = toInteger (W.q_ (W.gA_ :: W.WAPoint G1Curve.BLS12381 Fp Fr))

-- | (p + 1) / 4. Exponent for square roots in F_p (since p ≡ 3 mod 4).
fieldPrimePlus1Div4 :: Integer
fieldPrimePlus1Div4 = (fieldPrime + 1) `div` 4

-- | (p - 1) / 2. Exponent for the Legendre symbol / square test.
fieldPrimeMinus1Div2 :: Integer
fieldPrimeMinus1Div2 = (fieldPrime - 1) `div` 2

-- ============================================================================
-- Field-element helpers
-- ============================================================================

-- | sgn0 for prime fields (RFC 9380 §4.1): the LSB of the canonical
--   integer representative. Returns 1 if odd, 0 otherwise.
sgn0Fp :: Fp -> Int
sgn0Fp x = if testBit (toInteger x) 0 then 1 else 0

-- | Square root in F_p: @x^((p+1)/4)@ when p ≡ 3 (mod 4). The result is
--   meaningful only when @x@ is a quadratic residue; pair with
--   'isSquareFp' to check.
sqrtFp :: Fp -> Fp
sqrtFp x = x ^ fieldPrimePlus1Div4

-- | Quadratic-residue test in F_p via Euler's criterion. Returns True
--   for @0@ in addition to proper QRs (RFC 9380 convention).
isSquareFp :: Fp -> Bool
isSquareFp x =
  let r = x ^ fieldPrimeMinus1Div2
   in r == 0 || r == 1

-- | Modular inverse with the convention @inv0(0) = 0@ (RFC 9380 §F.2).
inv0Fp :: Fp -> Fp
inv0Fp v = if v == 0 then 0 else recip v

-- ============================================================================
-- E'_iso curve constants (RFC 9380 §E.2)
-- ============================================================================

-- | A' coefficient of the isogenous curve E'_iso: @y² = x³ + A'·x + B'@.
g1IsoA :: Fp
g1IsoA =
  fromInteger
    0x144698a3b8e9433d693a02c96d4982b0ea985383ee66a8d8e8981aefd881ac98936f8da0e0f97f5cf428082d584c1d

-- | B' coefficient of E'_iso.
g1IsoB :: Fp
g1IsoB =
  fromInteger
    0x12e2908d11688030018b12e8753eee3b2016c1f0f24f4070a0b9c14fcef35ef55a23215a316ceaa5d1cc48e98e172be0

-- | Z parameter for the simplified-SWU map. RFC 9380 §E.2 specifies @Z = 11@.
g1IsoZ :: Fp
g1IsoZ = fromInteger 11

-- | h_eff_G1 = 1 - z, where z = -0xd201000000010000 is the BLS-381
--   curve parameter. Multiplication by this scalar maps any point on
--   E into the prime-order subgroup r·G1.
g1Heff :: Integer
g1Heff = 0xd201000000010001

-- ============================================================================
-- 11-isogeny coefficients (RFC 9380 §E.2 / §C.2)
-- ============================================================================

-- The four polynomials k_1..k_4 (in 'x' alone) defining the isogeny
-- E'_iso → E. Coefficients are stored least-significant-first to match
-- 'hornerFp's evaluation order. Provenance: each list is k_(i, 0..n)
-- from RFC 9380 Appendix E.2 verbatim. Test against §J.9.1 vectors is
-- the integrity check.

g1IsoXnumCoeffs :: [Integer]
g1IsoXnumCoeffs =
  [ 0x11a05f2b1e833340b809101dd99815856b303e88a2d7005ff2627b56cdb4e2c85610c2d5f2e62d6eaeac1662734649b7,
    0x17294ed3e943ab2f0588bab22147a81c7c17e75b2f6a8417f565e33c70d1e86b4838f2a6f318c356e834eef1b3cb83bb,
    0xd54005db97678ec1d1048c5d10a9a1bce032473295983e56878e501ec68e25c958c3e3d2a09729fe0179f9dac9edcb0,
    0x1778e7166fcc6db74e0609d307e55412d7f5e4656a8dbf25f1b33289f1b330835336e25ce3107193c5b388641d9b6861,
    0xe99726a3199f4436642b4b3e4118e5499db995a1257fb3f086eeb65982fac18985a286f301e77c451154ce9ac8895d9,
    0x1630c3250d7313ff01d1201bf7a74ab5db3cb17dd952799b9ed3ab9097e68f90a0870d2dcae73d19cd13c1c66f652983,
    0xd6ed6553fe44d296a3726c38ae652bfb11586264f0f8ce19008e218f9c86b2a8da25128c1052ecaddd7f225a139ed84,
    0x17b81e7701abdbe2e8743884d1117e53356de5ab275b4db1a682c62ef0f2753339b7c8f8c8f475af9ccb5618e3f0c88e,
    0x80d3cf1f9a78fc47b90b33563be990dc43b756ce79f5574a2c596c928c5d1de4fa295f296b74e956d71986a8497e317,
    0x169b1f8e1bcfa7c42e0c37515d138f22dd2ecb803a0c5c99676314baf4bb1b7fa3190b2edc0327797f241067be390c9e,
    0x10321da079ce07e272d8ec09d2565b0dfa7dccdde6787f96d50af36003b14866f69b771f8c285decca67df3f1605fb7b,
    0x6e08c248e260e70bd1e962381edee3d31d79d7e22c837bc23c0bf1bc24c6b68c24b1b80b64d391fa9c8ba2e8ba2d229
  ]

g1IsoXdenCoeffs :: [Integer]
g1IsoXdenCoeffs =
  [ 0x8ca8d548cff19ae18b2e62f4bd3fa6f01d5ef4ba35b48ba9c9588617fc8ac62b558d681be343df8993cf9fa40d21b1c,
    0x12561a5deb559c4348b4711298e536367041e8ca0cf0800c0126c2588c48bf5713daa8846cb026e9e5c8276ec82b3bff,
    0xb2962fe57a3225e8137e629bff2991f6f89416f5a718cd1fca64e00b11aceacd6a3d0967c94fedcfcc239ba5cb83e19,
    0x3425581a58ae2fec83aafef7c40eb545b08243f16b1655154cca8abc28d6fd04976d5243eecf5c4130de8938dc62cd8,
    0x13a8e162022914a80a6f1d5f43e7a07dffdfc759a12062bb8d6b44e833b306da9bd29ba81f35781d539d395b3532a21e,
    0xe7355f8e4e667b955390f7f0506c6e9395735e9ce9cad4d0a43bcef24b8982f7400d24bc4228f11c02df9a29f6304a5,
    0x772caacf16936190f3e0c63e0596721570f5799af53a1894e2e073062aede9cea73b3538f0de06cec2574496ee84a3a,
    0x14a7ac2a9d64a8b230b3f5b074cf01996e7f63c21bca68a81996e1cdf9822c580fa5b9489d11e2d311f7d99bbdcc5a5e,
    0xa10ecf6ada54f825e920b3dafc7a3cce07f8d1d7161366b74100da67f39883503826692abba43704776ec3a79a1d641,
    0x95fc13ab9e92ad4476d6e3eb3a56680f682b4ee96f7d03776df533978f31c1593174e4b4b7865002d6384d168ecdd0a
  ]

g1IsoYnumCoeffs :: [Integer]
g1IsoYnumCoeffs =
  [ 0x90d97c81ba24ee0259d1f094980dcfa11ad138e48a869522b52af6c956543d3cd0c7aee9b3ba3c2be9845719707bb33,
    0x134996a104ee5811d51036d776fb46831223e96c254f383d0f906343eb67ad34d6c56711962fa8bfe097e75a2e41c696,
    0xcc786baa966e66f4a384c86a3b49942552e2d658a31ce2c344be4b91400da7d26d521628b00523b8dfe240c72de1f6,
    0x1f86376e8981c217898751ad8746757d42aa7b90eeb791c09e4a3ec03251cf9de405aba9ec61deca6355c77b0e5f4cb,
    0x8cc03fdefe0ff135caf4fe2a21529c4195536fbe3ce50b879833fd221351adc2ee7f8dc099040a841b6daecf2e8fedb,
    0x16603fca40634b6a2211e11db8f0a6a074a7d0d4afadb7bd76505c3d3ad5544e203f6326c95a807299b23ab13633a5f0,
    0x4ab0b9bcfac1bbcb2c977d027796b3ce75bb8ca2be184cb5231413c4d634f3747a87ac2460f415ec961f8855fe9d6f2,
    0x987c8d5333ab86fde9926bd2ca6c674170a05bfe3bdd81ffd038da6c26c842642f64550fedfe935a15e4ca31870fb29,
    0x9fc4018bd96684be88c9e221e4da1bb8f3abd16679dc26c1e8b6e6a1f20cabe69d65201c78607a360370e577bdba587,
    0xe1bba7a1186bdb5223abde7ada14a23c42a0ca7915af6fe06985e7ed1e4d43b9b3f7055dd4eba6f2bafaaebca731c30,
    0x19713e47937cd1be0dfd0b8f1d43fb93cd2fcbcb6caf493fd1183e416389e61031bf3a5cce3fbafce813711ad011c132,
    0x18b46a908f36f6deb918c143fed2edcc523559b8aaf0c2462e6bfe7f911f643249d9cdf41b44d606ce07c8a4d0074d8e,
    0xb182cac101b9399d155096004f53f447aa7b12a3426b08ec02710e807b4633f06c851c1919211f20d4c04f00b971ef8,
    0x245a394ad1eca9b72fc00ae7be315dc757b3b080d4c158013e6632d3c40659cc6cf90ad1c232a6442d9d3f5db980133,
    0x5c129645e44cf1102a159f748c4a3fc5e673d81d7e86568d9ab0f5d396a7ce46ba1049b6579afb7866b1e715475224b,
    0x15e6be4e990f03ce4ea50b3b42df2eb5cb181d8f84965a3957add4fa95af01b2b665027efec01c7704b456be69c8b604
  ]

g1IsoYdenCoeffs :: [Integer]
g1IsoYdenCoeffs =
  [ 0x16112c4c3a9c98b252181140fad0eae9601a6de578980be6eec3232b5be72e7a07f3688ef60c206d01479253b03663c1,
    0x1962d75c2381201e1a0cbd6c43c348b885c84ff731c4d59ca4a10356f453e01f78a4260763529e3532f6102c2e49a03d,
    0x58df3306640da276faaae7d6e8eb15778c4855551ae7f310c35a5dd279cd2eca6757cd636f96f891e2538b53dbf67f2,
    0x16b7d288798e5395f20d23bf89edb4d1d115c5dbddbcd30e123da489e726af41727364f2c28297ada8d26d98445f5416,
    0xbe0e079545f43e4b00cc912f8228ddcc6d19c9f0f69bbb0542eda0fc9dec916a20b15dc0fd2ededda39142311a5001d,
    0x8d9e5297186db2d9fb266eaac783182b70152c65550d881c5ecd87b6f0f5a6449f38db9dfa9cce202c6477faaf9b7ac,
    0x166007c08a99db2fc3ba8734ace9824b5eecfdfa8d0cf8ef5dd365bc400a0051d5fa9c01a58b1fb93d1a1399126a775c,
    0x16a3ef08be3ea7ea03bcddfabba6ff6ee5a4375efa1f4fd7feb34fd206357132b920f5b00801dee460ee415a15812ed9,
    0x1866c8ed336c61231a1be54fd1d74cc4f9fb0ce4c6af5920abc5750c4bf39b4852cfe2f7bb9248836b233d9d55535d4a,
    0x167a55cda70a6e1cea820597d94a84903216f763e13d87bb5308592e7ea7d4fbc7385ea3d529b35e346ef48bb8913f55,
    0x4d2f259eea405bd48f010a01ad2911d9c6dd039bb61a6290e591b36e636a5c871a5c29f4f83060400f8b49cba8f6aa8,
    0xaccbb67481d033ff5852c1e48c50c477f94ff8aefce42d28c0f9a88cea7913516f968986f7ebbea9684b529e2561092,
    0xad6b9514c767fe3c3613144b45f1496543346d98adf02267d5ceef9a00d9b8693000763e3b90ac11e99b138573345cc,
    0x2660400eb2e4f3b628bdd0d53cd76f2bf565b94e72927c1cb748df27942480e420517bd8714cc80d1fadc1326ed06f7,
    0xe0fa1d816ddc03e6b24255e0d7819c171c40f65e273b853324efcd6356caa205ca2f570f13497804415473a1d634b8f
  ]

-- ============================================================================
-- Stage 1: simplified-SWU on E'_iso
-- ============================================================================

-- | RFC 9380 §6.6.2 case @q ≡ 3 (mod 4)@. Map @u ∈ F_p@ to a point on
--   E'_iso(F_p) — guaranteed to lie on the iso curve, but not yet on
--   E or in the prime-order subgroup.
simplifiedSwuG1Iso :: Fp -> (Fp, Fp)
simplifiedSwuG1Iso u =
  let zU2 = g1IsoZ * u * u
      zU2Sq = zU2 * zU2
      tv1 = inv0Fp (zU2Sq + zU2)
      x1 =
        if tv1 == 0
          then g1IsoB / (g1IsoZ * g1IsoA)
          else (-(g1IsoB / g1IsoA)) * (1 + tv1)
      gx1 = x1 * x1 * x1 + g1IsoA * x1 + g1IsoB
      x2 = zU2 * x1
      gx2 = x2 * x2 * x2 + g1IsoA * x2 + g1IsoB
      (x, yC) =
        if isSquareFp gx1
          then (x1, sqrtFp gx1)
          else (x2, sqrtFp gx2)
      -- Force y to share the LSB-parity of u (the canonical
      -- y-disambiguation in RFC 9380).
      y = if sgn0Fp u == sgn0Fp yC then yC else negate yC
   in (x, y)

-- ============================================================================
-- Stage 2: 11-isogeny back to E
-- ============================================================================

-- | Evaluate @Σᵢ aᵢ · x^i@ via Horner's method. Coefficients are in
--   ascending-degree order (a_0 first).
hornerFp :: [Fp] -> Fp -> Fp
hornerFp coeffs x = foldr (\c acc -> acc * x + c) 0 coeffs

-- | Evaluate a monic polynomial: @x^n + Σᵢ aᵢ · x^i@ where @n@ is the
--   length of @coeffs@ and the leading 1 is implicit.
hornerMonicFp :: [Fp] -> Fp -> Fp
hornerMonicFp coeffs x =
  let n = length coeffs
   in hornerFp coeffs x + x ^ n

-- | Apply the 11-isogeny map E'_iso → E. The output @(x', y')@ lies on
--   BLS12-381 G1 (E: y² = x³ + 4) but may still be outside the
--   prime-order subgroup; 'clearCofactorG1' handles that.
isoMapG1 :: (Fp, Fp) -> G1
isoMapG1 (x, y) =
  let toF = map fromInteger :: [Integer] -> [Fp]
      xnum = hornerFp (toF g1IsoXnumCoeffs) x
      xden = hornerMonicFp (toF g1IsoXdenCoeffs) x
      ynum = hornerFp (toF g1IsoYnumCoeffs) x
      yden = hornerMonicFp (toF g1IsoYdenCoeffs) x
   in if xden == 0 || yden == 0
        then O -- denominators zero out -> point at infinity
        else A (xnum / xden) (y * (ynum / yden))

-- ============================================================================
-- Stage 3: cofactor clearing
-- ============================================================================

-- | Multiply by @h_eff_G1 = 1 - z@ to land in r·G1.
clearCofactorG1 :: G1 -> G1
clearCofactorG1 p = mul p (fromInteger g1Heff :: Fr)

-- ============================================================================
-- Public entry point
-- ============================================================================

-- | EIP-2537 BLS12_MAP_FP_TO_G1: given an integer interpretation of an
--   F_p element, run the three-stage pipeline and return the resulting
--   G1 point in r·G1.
mapFpToG1Pt :: Integer -> G1
mapFpToG1Pt uInt =
  let u = fromInteger uInt :: Fp
      (xIso, yIso) = simplifiedSwuG1Iso u
      pE = isoMapG1 (xIso, yIso)
   in clearCofactorG1 pE
