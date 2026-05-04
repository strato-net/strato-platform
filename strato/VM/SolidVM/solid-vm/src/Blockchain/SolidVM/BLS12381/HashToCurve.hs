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
  )
where

import Blockchain.SolidVM.BLS12381.HashToCurve.G1 (clearCofactorG1, mapFpToG1Pt)
import qualified Data.ByteString as B
import qualified Data.Word as W
import Data.Bits (shiftL)
import Data.Foldable (foldl')
import Data.Curve.Weierstrass (Point (..))

-- ---- EIP-2537 byte codecs (mirror those in 'Blockchain.SolidVM.BLS12381') ----

fpSize, g1Size :: Int
fpSize = 64
g1Size = 2 * fpSize

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

-- | EIP-2537 BLS12_MAP_FP2_TO_G2 -- not yet implemented. The G2 case
--   follows the same pipeline as G1 but over F_p^2 with a 3-isogeny.
--   Once 'Blockchain.SolidVM.BLS12381.HashToCurve.G2' lands the body
--   here mirrors 'mapFpToG1'.
mapFp2ToG2 :: B.ByteString -> Either String B.ByteString
mapFp2ToG2 _ =
  Left
    "bls12381MapFp2ToG2: G2 hash-to-curve not yet implemented. The G1 case \
    \(bls12381MapFpToG1) is wired up; G2 will follow once we port the \
    \3-isogeny + cofactor-clearing constants from RFC 9380 §E.3 the same \
    \way G1's were."
