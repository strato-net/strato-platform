{-# LANGUAGE OverloadedStrings #-}

-- |
-- BLS12-381 point compression / decompression in the IETF / ZCash format
-- used by Ethereum's beacon chain (sync-committee aggregates, validator
-- BLS signatures), the IETF BLS-signature draft, and most consensus
-- implementations.
--
-- Compressed format (per the ZCash BLS12-381 serialization spec):
--
--   Top 3 bits of byte 0 are flags:
--     bit 7 (MSB): COMPRESSED  — must be 1 for compressed encoding
--     bit 6:       INFINITY    — 1 ⇒ point at infinity (all other bits zero)
--     bit 5:       Y_LARGER    — 1 ⇒ y > -y in lex order, else 0
--
--   For G1 (48 bytes total):
--     bytes 0..47 = x || flags-in-top-3-bits-of-byte-0
--     y is recovered from y² = x³ + 4 mod p; lex sign picks branch.
--
--   For G2 (96 bytes total):
--     bytes 0..47  = x.c1 || flags-in-top-3-bits-of-byte-0  (c1 first!)
--     bytes 48..95 = x.c0
--     y is recovered from y² = x³ + 4(1+u) over F_p²; lex sign on
--     (y.c1, y.c0) picks branch.
--
-- EIP-2537 / SolidVM uncompressed format (what 'bls12381Pairing' et al
-- consume):
--
--   G1: 128 bytes = x.64 || y.64, each F_p in 16-byte zero-pad + 48 bytes value
--   G2: 256 bytes = xc0.64 || xc1.64 || yc0.64 || yc1.64
--
-- This module bridges the two so a Solidity contract can take what a
-- beacon node API returns and feed it directly into the EIP-2537
-- precompile family.
module Blockchain.SolidVM.BLS12381.Compress
  ( decompressG1,
    decompressG2,
  )
where

import Blockchain.SolidVM.BLS12381.HashToCurve.G1
  ( Fp,
    fieldPrime,
    fieldPrimeMinus1Div2,
    isSquareFp,
    sqrtFp,
  )
import Blockchain.SolidVM.BLS12381.HashToCurve.G2
  ( fp2Pair,
    isSquareFp2,
    mkFp2,
    sqrtFp2,
  )
import Data.Bits (clearBit, shiftL, testBit)
import qualified Data.ByteString as B
import Data.Foldable (foldl')
import Data.Pairing.BLS12381 (Fq2)
import qualified Data.Word as W

-- ---- Encoding constants (mirror those in 'Blockchain.SolidVM.BLS12381') ----

fpSize, g1Size, fp2Size, g2Size :: Int
fpSize = 64
g1Size = 2 * fpSize
fp2Size = 2 * fpSize
g2Size = 2 * fp2Size

-- Compressed encoding sizes. F_p in compressed form is 48 raw bytes
-- (no zero-pad — the top 3 bits of byte 0 are flags).
fpCompressedSize, g1CompressedSize, g2CompressedSize :: Int
fpCompressedSize = 48
g1CompressedSize = fpCompressedSize
g2CompressedSize = 2 * fpCompressedSize

beToInteger :: B.ByteString -> Integer
beToInteger = foldl' (\acc w -> (acc `shiftL` 8) + fromIntegral w) 0 . B.unpack

integerToBE :: Int -> Integer -> B.ByteString
integerToBE n i =
  let go 0 _ = []
      go k v = go (k - 1) (v `quot` 256) ++ [fromIntegral (v `rem` 256) :: W.Word8]
   in B.pack (go n i)

-- | EIP-2537 F_p encoding: 16 zero bytes + 48 bytes of value.
encodeFp :: Integer -> B.ByteString
encodeFp = integerToBE fpSize

-- ---- Compressed-byte parsing helpers ----

-- | Split a compressed-byte input into (compressionFlag, infinityFlag,
--   yLargerFlag, payloadBytes) where payloadBytes has the top 3 flag
--   bits of byte 0 cleared (so it parses as a clean big-endian integer).
parseCompressed :: B.ByteString -> (Bool, Bool, Bool, B.ByteString)
parseCompressed bs =
  let b0 = B.head bs
      compFlag = testBit b0 7
      infFlag = testBit b0 6
      yFlag = testBit b0 5
      cleared = clearBit (clearBit (clearBit b0 7) 6) 5
      payload = B.cons cleared (B.tail bs)
   in (compFlag, infFlag, yFlag, payload)

-- ---- G1 decompression ----

-- | Decode a 48-byte compressed G1 point and re-encode it in EIP-2537
--   uncompressed form (128 bytes). Returns the EIP-2537 zero-encoded
--   point at infinity for the infinity flag.
--
--   Failure modes:
--     - wrong input length
--     - compression flag clear (caller passed an uncompressed encoding)
--     - infinity flag set together with the y-sign flag (invalid)
--     - infinity flag set with non-zero x bytes
--     - x ≥ p (canonicality)
--     - y² is not a QR in F_p (point not on E: y² = x³ + 4)
decompressG1 :: B.ByteString -> Either String B.ByteString
decompressG1 input
  | B.length input /= g1CompressedSize =
      Left $ "decompressG1: expected " <> show g1CompressedSize <> " bytes, got " <> show (B.length input)
  | not compFlag =
      Left "decompressG1: compression flag (high bit of byte 0) must be set"
  | infFlag && yFlag =
      Left "decompressG1: infinity flag cannot be set together with the y-sign flag"
  | infFlag && not (B.all (== 0) payload) =
      Left "decompressG1: infinity flag set but x bytes are non-zero"
  | infFlag = Right (B.replicate g1Size 0)
  | xInt >= fieldPrime =
      Left "decompressG1: x ≥ p (non-canonical x coordinate)"
  | not (isSquareFp ySq) =
      Left "decompressG1: y² is not a quadratic residue (point not on curve)"
  | otherwise = Right (encodeFp xInt <> encodeFp yInt)
  where
    (compFlag, infFlag, yFlag, payload) = parseCompressed input
    xInt = beToInteger payload
    x = fromInteger xInt :: Fp
    -- BLS12-381 G1 curve constant B = 4. y² = x³ + 4.
    ySq = x * x * x + 4
    yCandidate = sqrtFp ySq
    yIntCand = toInteger yCandidate
    -- Lex sign in F_p: y > (p-1)/2 ⇔ y > -y. Match the requested flag.
    yLargerCand = yIntCand > fieldPrimeMinus1Div2
    yInt =
      if yLargerCand == yFlag
        then yIntCand
        else fieldPrime - yIntCand -- the other root

-- ---- G2 decompression ----

-- | Lex sign for an F_p² element y = (y.c0, y.c1):
--
--   sign(y) = 1  iff  y.c1 > (p-1)/2
--                OR  (y.c1 == 0 AND y.c0 > (p-1)/2)
--
--   Equivalent to "y > -y in lex order on (c1, c0)" — c1 is the
--   high-order coefficient because of the polynomial basis u² = -1.
fp2YLarger :: Fq2 -> Bool
fp2YLarger e =
  let (c0, c1) = fp2Pair e
      c0i = toInteger c0
      c1i = toInteger c1
   in (c1i > fieldPrimeMinus1Div2)
        || (c1i == 0 && c0i > fieldPrimeMinus1Div2)

-- | Decode a 96-byte compressed G2 point and re-encode it in EIP-2537
--   uncompressed form (256 bytes). Encoding caveat: the compressed byte
--   layout is @x.c1 || x.c0@ (c1 first) but the EIP-2537 layout is
--   @x.c0 || x.c1 || y.c0 || y.c1@ (c0 first) — we swap during
--   re-encoding.
--
--   Failure modes mirror 'decompressG1', extended for F_p²:
--     - either of x.c0 / x.c1 ≥ p
--     - y² is not a QR in F_p² (point not on the twist E2)
decompressG2 :: B.ByteString -> Either String B.ByteString
decompressG2 input
  | B.length input /= g2CompressedSize =
      Left $ "decompressG2: expected " <> show g2CompressedSize <> " bytes, got " <> show (B.length input)
  | not compFlag =
      Left "decompressG2: compression flag (high bit of byte 0) must be set"
  | infFlag && yFlag =
      Left "decompressG2: infinity flag cannot be set together with the y-sign flag"
  | infFlag && (not (B.all (== 0) c1Payload) || not (B.all (== 0) c0Payload)) =
      Left "decompressG2: infinity flag set but x bytes are non-zero"
  | infFlag = Right (B.replicate g2Size 0)
  | c1Int >= fieldPrime || c0Int >= fieldPrime =
      Left "decompressG2: x.c0 or x.c1 ≥ p (non-canonical x coordinate)"
  | not (isSquareFp2 ySq) =
      Left "decompressG2: y² is not a quadratic residue in F_p² (point not on twist)"
  | otherwise =
      Right $
        encodeFp c0Int <> encodeFp c1Int -- x.c0 || x.c1 (EIP-2537 order)
          <> encodeFp (toInteger y0c0)
          <> encodeFp (toInteger y0c1)
  where
    -- Compressed G2: bytes 0..47 = x.c1 (with flags in byte 0), bytes 48..95 = x.c0.
    c1Bytes = B.take fpCompressedSize input
    c0Bytes = B.drop fpCompressedSize input
    (compFlag, infFlag, yFlag, c1Payload) = parseCompressed c1Bytes
    c0Payload = c0Bytes -- already flag-free
    c1Int = beToInteger c1Payload
    c0Int = beToInteger c0Bytes
    -- BLS12-381 G2 twist constant B = 4(1+u). y² = x³ + 4(1+u) over F_p².
    x = mkFp2 c0Int c1Int
    twistB = mkFp2 4 4
    ySq = x * x * x + twistB
    yCandidate = sqrtFp2 ySq
    (yCandC0, yCandC1) = fp2Pair yCandidate
    yLargerCand = fp2YLarger yCandidate
    -- Negation of y in F_p² is component-wise negation in F_p.
    (y0c0, y0c1) =
      if yLargerCand == yFlag
        then (yCandC0, yCandC1)
        else (negate yCandC0, negate yCandC1)
