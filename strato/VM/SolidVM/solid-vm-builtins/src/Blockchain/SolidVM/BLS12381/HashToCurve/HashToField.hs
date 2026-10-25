{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}

-- |
-- RFC 9380 §5.2 hash_to_field, plus the expand_message_xmd (SHA-256)
-- helper from §5.3.1. Used to derive @u[]@ field elements from a
-- message before feeding them into 'mapFpToG1Pt'.
--
-- We don't expose this to SolidVM directly (EIP-2537's BLS precompiles
-- take pre-derived F_p / F_p^2 inputs and don't include hash_to_field
-- — the host application picks its own DST and SHA backend). The
-- module exists primarily as a diagnostic harness so we can verify our
-- map_to_curve against RFC 9380 §J.9.1 test vectors directly from the
-- published message strings, rather than having to hand-transcribe the
-- intermediate u values.
module Blockchain.SolidVM.BLS12381.HashToCurve.HashToField
  ( hashToFieldFp,
    hashToFieldFp2,
    expandMessageXmdSHA256,
  )
where

import "crypton" Crypto.Hash (Digest, SHA256, hash)
import Data.Bits (shiftL, xor)
import qualified Data.ByteArray as BA
import qualified Data.ByteString as B
import Data.Foldable (foldl')
import qualified Data.Word as W

-- ============================================================================
-- expand_message_xmd (RFC 9380 §5.3.1)
-- ============================================================================

-- | SHA-256 output size in bytes.
bInBytes :: Int
bInBytes = 32

-- | SHA-256 input block size in bytes (the 's_in_bytes' parameter in
--   RFC 9380's notation).
sInBytes :: Int
sInBytes = 64

-- | I2OSP: integer-to-octet-string-primitive. Encode @i@ as @n@-byte
--   big-endian. Bombs out if @i@ doesn't fit in @n@ bytes — caller's
--   responsibility to size correctly.
i2osp :: Int -> Int -> B.ByteString
i2osp n i
  | i < 0 = error "i2osp: negative"
  | otherwise =
      let go 0 _ = []
          go k v = go (k - 1) (v `quot` 256) ++ [fromIntegral (v `rem` 256) :: W.Word8]
       in B.pack (go n i)

-- | Byte-wise XOR of two equal-length ByteStrings.
strxor :: B.ByteString -> B.ByteString -> B.ByteString
strxor a b = B.pack (B.zipWith xor a b)

-- | One SHA-256 round, packed back as a ByteString.
sha256 :: B.ByteString -> B.ByteString
sha256 bs = B.pack (BA.unpack (hash bs :: Digest SHA256))

-- | RFC 9380 §5.3.1 expand_message_xmd, instantiated with SHA-256.
--   Produces @len@ bytes of output uniformly distributed over the
--   message+DST input. Bounded by @len <= 255 * 32 = 8160@ bytes (RFC
--   constraint); we don't validate since callers in this codebase use
--   small fixed lengths.
expandMessageXmdSHA256 :: B.ByteString -> B.ByteString -> Int -> B.ByteString
expandMessageXmdSHA256 msg dst len =
  let ell = (len + bInBytes - 1) `div` bInBytes -- ceil(len / 32)
      dstPrime = dst <> i2osp 1 (B.length dst)
      zPad = B.replicate sInBytes 0
      lIbStr = i2osp 2 len
      msgPrime = zPad <> msg <> lIbStr <> i2osp 1 0 <> dstPrime
      b0 = sha256 msgPrime
      -- b_1 = SHA(b_0 || 0x01 || DST')
      b1 = sha256 (b0 <> i2osp 1 1 <> dstPrime)
      -- b_i = SHA(strxor(b_0, b_{i-1}) || I2OSP(i, 1) || DST')
      buildBs prev acc i
        | i > ell = reverse acc
        | otherwise =
            let bi = sha256 (strxor b0 prev <> i2osp 1 i <> dstPrime)
             in buildBs bi (bi : acc) (i + 1)
      bs = b1 : buildBs b1 [] 2
   in B.take len (B.concat bs)

-- ============================================================================
-- hash_to_field (RFC 9380 §5.2)
-- ============================================================================

-- | Big-endian byte string -> non-negative integer.
beToInteger :: B.ByteString -> Integer
beToInteger = foldl' (\acc w -> (acc `shiftL` 8) + fromIntegral w) 0 . B.unpack

-- | RFC 9380 §5.2 hash_to_field for a prime field of order @p@.
--
--   @hashToFieldFp msg dst count L p@ produces @count@ field elements
--   in F_p, where @L@ is the byte length used to derive each (per the
--   RFC: @L = ceil((ceil(log2(p)) + k) / 8)@ with @k = 128@ for
--   128-bit security; for BLS12-381 G1 this is @L = 64@). For
--   BLS12381G1_XMD:SHA-256_SSWU_RO_, @count = 2@.
hashToFieldFp ::
  -- | Message bytes.
  B.ByteString ->
  -- | Domain separation tag.
  B.ByteString ->
  -- | Number of field elements to produce.
  Int ->
  -- | Per-element length (L).
  Int ->
  -- | Field modulus.
  Integer ->
  [Integer]
hashToFieldFp msg dst count l p =
  let totalLen = count * l
      uniformBytes = expandMessageXmdSHA256 msg dst totalLen
      chunks i
        | i >= count = []
        | otherwise =
            let chunk = B.take l (B.drop (i * l) uniformBytes)
             in (beToInteger chunk `mod` p) : chunks (i + 1)
   in chunks 0

-- | hash_to_field for F_p^2 = F_p[u]/(u^2 + 1). Each output element is
--   represented as @(c0, c1)@ where the full element is @c0 + c1·u@.
--   Per RFC 9380 §5.2, this draws @2 * count@ raw F_p values from
--   expand_message_xmd and pairs them up.
hashToFieldFp2 ::
  B.ByteString ->
  B.ByteString ->
  Int ->
  Int ->
  Integer ->
  [(Integer, Integer)]
hashToFieldFp2 msg dst count l p =
  let raw = hashToFieldFp msg dst (2 * count) l p
      pairs (a : b : rest) = (a, b) : pairs rest
      pairs _ = []
   in pairs raw
