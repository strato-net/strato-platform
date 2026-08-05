{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM.Builtins
  ( -- * Monadic ABI functions (need MonadSM)
    encodeDynamicValue,
    abiEncode,
    abiEncodePacked,

    -- * Non-ABI builtins
    push,
    modExp,
    ecAdd,
    ecMul,
    ecPairing,
    poseidonHash,
    poseidon2Hash,
    poseidon2Compress,
    bls12381G1Add,
    bls12381G1Msm,
    bls12381G2Add,
    bls12381G2Msm,
    bls12381Pairing,
    bls12381G1AddInts,
    bls12381G1MsmInts,
    bls12381G2AddInts,
    bls12381G2MsmInts,
    bls12381PairingInts,
    mapFpToG1,
    mapFp2ToG2,
    hashToCurveG1,
    hashToCurveG2,
    decompressG1,
    decompressG2,
  )
where

import Blockchain.SolidVM.BLS12381
  ( bls12381G1Add,
    bls12381G1AddInts,
    bls12381G1Msm,
    bls12381G1MsmInts,
    bls12381G2Add,
    bls12381G2AddInts,
    bls12381G2Msm,
    bls12381G2MsmInts,
    bls12381Pairing,
    bls12381PairingInts,
  )
import Blockchain.SolidVM.BLS12381.Compress
  ( decompressG1,
    decompressG2,
  )
import Blockchain.SolidVM.BLS12381.HashToCurve
  ( hashToCurveG1,
    hashToCurveG2,
    mapFp2ToG2,
    mapFpToG1,
  )

import BlockApps.Solidity.ABI.Codec
import Blockchain.SolidVM.SM
import Blockchain.SolidVM.SetGet
import Blockchain.Strato.Model.Address (addressToByteString)
import Blockchain.VM.SolidException
import Control.Monad ((<=<))
import qualified Crypto.Hash.Poseidon as Poseidon
import Crypto.Hash.Poseidon.Field (fieldPrime)
import qualified Crypto.Hash.Poseidon2 as Poseidon2
import Data.Curve                   (Form(Weierstrass), Coordinates(Affine), dbl, def)
import Data.Curve.Weierstrass.BN254 (BN254, Fq, Fr, Point(..), add, mul, _q, _r)
import qualified Data.Curve.Weierstrass.BN254T as BN254T
import Data.Foldable (fold)
import Data.Maybe (isNothing)
import Data.Pairing                 (pairing)
import Data.Pairing.BN254           (Fq2, G2', GT')
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Vector as V
import GHC.Exts (IsList(fromList))
import qualified SolidVM.Model.Storable as MS
import SolidVM.Model.Value

-- Pushes a new value to an array and returns the length of the new array
push :: MonadSM m => Value -> Maybe Variable -> ValList -> m Variable
push (SReference apt) _ vals = do
  let av = case vals of
             [] -> SNULL
             (a:_) -> a
      lenPath = apt `MS.snoc` MS.Field "length"
  len' <- getInt $ Constant $ SReference lenPath
  let len :: Int = fromIntegral len'
      newLen = SInteger $ fromIntegral $ len + 1
      idxPath = apt `MS.snoc` MS.Index (BC.pack $ show len)
  setVar (Constant (SReference lenPath)) newLen
  setVar (Constant (SReference idxPath)) av
  return $ Constant newLen
push (SArray vec) (Just (Variable ref)) vals = do
  let av = case vals of
             [] -> SNULL
             (a:_) -> a
  newVar <- createVar av
  let newArr = V.snoc vec newVar
  setVar (Variable ref) (SArray newArr)
  return $ Constant (SInteger $ fromIntegral $ V.length newArr)
push v mv argVals = do
  invalidArguments "push" (v, mv, argVals)

modExp :: Integer -> Integer -> Integer -> Integer
modExp _ _ 0 = 0 -- EIP-198: a zero modulus yields zero
modExp _ e _ | e < 0 = invalidArguments "modExp" ("negative exponent" :: String)
modExp b e m =
  case (b, e, even e) of
    (_, 0, _) -> 1 -- 0^0 == 1, per EIP-198
    (0, _, _) -> 0
    (_, _, True) ->
      let y = modExp b (e `div` 2) m
        in (y * y) `mod` m
    (_, _, False) ->
      b * (modExp b (e - 1) m) `mod` m

-- | BN254 base field modulus @p@ and subgroup order @r@, for validating raw
-- integer inputs before they are reduced into field elements.
bnP :: Integer
bnP = toInteger _q

bnR :: Integer
bnR = toInteger _r

outOfRange :: Integer -> Bool
outOfRange c = c < 0 || c >= bnP

-- | Decode an affine G1 point with EIP-196 validation: coordinates must be
-- canonical (@0 <= c < p@) and satisfy the curve equation; (0, 0) denotes
-- the point at infinity. G1 has cofactor 1, so no subgroup check is needed.
g1Point :: String -> (Integer, Integer) -> Point Weierstrass Affine BN254 Fq Fr
g1Point caller (x, y)
  | outOfRange x || outOfRange y =
      invalidArguments caller $ "G1 coordinate out of range [0, p): " ++ show (x, y)
  | x == 0 && y == 0 = O
  | def p = p
  | otherwise = invalidArguments caller $ "G1 point is not on the curve: " ++ show (x, y)
  where
    p :: Point Weierstrass Affine BN254 Fq Fr
    p = A (fromInteger x) (fromInteger y)

-- | Decode an affine G2 point on the twist with EIP-197 validation:
-- canonical coordinates, on-curve, and in the r-order subgroup. The twist
-- has a large cofactor, so on-curve alone is not sufficient: pairing a
-- non-subgroup G2 point can satisfy a verifier's pairing equation with a
-- forged proof.
g2Point :: String -> ((Integer, Integer), (Integer, Integer)) -> G2'
g2Point caller ((xr, xi), (yr, yi))
  | any outOfRange [xr, xi, yr, yi] =
      invalidArguments caller $ "G2 coordinate out of range [0, p): " ++ show ((xr, xi), (yr, yi))
  | all (== 0) [xr, xi, yr, yi] = O
  | not (g2OnTwist x y) =
      invalidArguments caller $ "G2 point is not on the twist curve: " ++ show ((xr, xi), (yr, yi))
  | not (g2InSubgroup (x, y)) =
      invalidArguments caller $ "G2 point is not in the r-order subgroup: " ++ show ((xr, xi), (yr, yi))
  | otherwise = A x y
  where
    toFq2 :: (Integer, Integer) -> Fq2
    toFq2 (u, v) = fromList [fromInteger u, fromInteger v]
    x = toFq2 (xr, xi)
    y = toFq2 (yr, yi)

-- The elliptic-curve fork provides no Curve instance for the twist (G2
-- points are only ever constructed raw and fed to `pairing`), so the two
-- validation predicates are implemented directly over Fq2.

-- | The twist equation: y^2 = x^3 + b' with b' = 3/(9+u).
g2OnTwist :: Fq2 -> Fq2 -> Bool
g2OnTwist x y = y * y == x * x * x + BN254T._b

-- | A point on the twist is in the r-order subgroup iff [r]P is the point
-- at infinity; the twist's full group order is r * h with a ~254-bit
-- cofactor h.
g2InSubgroup :: (Fq2, Fq2) -> Bool
g2InSubgroup = isNothing . go bnR . Just
  where
    -- affine double-and-add; Nothing is the point at infinity
    go :: Integer -> Maybe (Fq2, Fq2) -> Maybe (Fq2, Fq2)
    go 0 _ = Nothing
    go _ Nothing = Nothing
    go k p =
      let half = go (k `div` 2) (g2Dbl =<< p)
       in if odd k then g2AddAff p half else half
    g2AddAff :: Maybe (Fq2, Fq2) -> Maybe (Fq2, Fq2) -> Maybe (Fq2, Fq2)
    g2AddAff Nothing q = q
    g2AddAff p Nothing = p
    g2AddAff (Just p1@(x1, y1)) (Just (x2, y2))
      | x1 /= x2 =
          let l = (y2 - y1) / (x2 - x1)
              x3 = l * l - x1 - x2
           in Just (x3, l * (x1 - x3) - y1)
      | y1 == y2 && y1 /= 0 = g2Dbl p1
      | otherwise = Nothing
    g2Dbl :: (Fq2, Fq2) -> Maybe (Fq2, Fq2)
    g2Dbl (x, y)
      | y == 0 = Nothing
      | otherwise =
          let l = (3 * x * x) / (2 * y)
              x3 = l * l - 2 * x
           in Just (x3, l * (x - x3) - y)

unpoint :: Point Weierstrass Affine BN254 Fq Fr -> (Integer, Integer)
unpoint (A x y) = (toInteger x, toInteger y)
unpoint O       = (0, 0)

ecAdd :: (Integer, Integer) -> (Integer, Integer) -> (Integer, Integer)
ecAdd p1 p2 =
  let q1 = g1Point "ecAdd" p1
      q2 = g1Point "ecAdd" p2
      -- the affine `add` is incomplete addition (P + P yields O); Ethereum's
      -- ecAdd precompile doubles, so dispatch to dbl on equal points
   in unpoint (if q1 == q2 then dbl q1 else add q1 q2)

ecMul :: (Integer, Integer) -> Integer -> (Integer, Integer)
ecMul p s = unpoint (mul (g1Point "ecMul" p) (fromInteger s :: Fr))

ecPairing :: [Integer] -> Bool
ecPairing = doPairing . toTrios
  -- Ethereum orders the coordinates as x1, y1, x2Imag, x2Real, y2Imag, y2Real
  -- so toTrios regroups them to ((x1, y1), ((x2Real, x2Imag), (y2Real, y2Imag))),
  -- which is the order in which pairing library (and poly library under the hood) expects
  where toTrios (a:b:c:d:e:f:g) = ((a, b), ((d, c), (f, e))) : toTrios g
        toTrios [] = []
        toTrios _ = invalidArguments "ecPairing" ("input length must be a multiple of 6" :: String)
        doPairing trios =
          let acc :: GT'
              -- a pair containing the point at infinity contributes the
              -- identity, so it is validated but excluded from the product
              acc = mconcat
                [ pairing p1 p2
                | (c1, c2) <- trios
                , let p1 = g1Point "ecPairing" c1
                , let p2 = g2Point "ecPairing" c2
                , p1 /= O
                , p2 /= O
                ]
           in acc == mempty

-- | Poseidon hash - ZK-friendly hash function over BN254 scalar field
-- Takes a list of integers (field elements) and returns their Poseidon hash
poseidonHash :: [Integer] -> Integer
poseidonHash inputs = Poseidon.fromF $ Poseidon.poseidon (map Poseidon.toF inputs)

-- | Poseidon2 hash (gnark-crypto BN254 defaults: t=2, rF=6, rP=50):
-- Merkle–Damgård over the 2-to-1 compression, matching gnark circuits'
-- @std/hash/poseidon2@ gadget. Inputs must be canonical field elements —
-- silently reducing them would hash a different preimage than the caller's
-- circuit sees.
poseidon2Hash :: [Integer] -> Integer
poseidon2Hash = Poseidon.fromF . Poseidon2.hash . map (canonicalF "poseidon2")

-- | The raw gnark Poseidon2 2-to-1 compression (right-input feed-forward),
-- the node function for Merkle trees in gnark circuits.
poseidon2Compress :: Integer -> Integer -> Integer
poseidon2Compress l r =
  Poseidon.fromF $
    Poseidon2.compress (canonicalF "poseidon2Compress" l) (canonicalF "poseidon2Compress" r)

canonicalF :: String -> Integer -> Poseidon.F
canonicalF caller v
  | v < 0 || v >= fieldPrime =
      invalidArguments caller $ "input is not a canonical field element in [0, r): " ++ show v
  | otherwise = Poseidon.toF v

--------------------------------------------------------------------------------
-- Monadic ABI functions (need MonadSM for variable dereferencing)
--------------------------------------------------------------------------------

encodeDynamicValue :: MonadSM m => Value -> m B.ByteString
encodeDynamicValue (SBytes bs) = pure $
  encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeDynamicValue (SString s) = pure $
  let bs = BC.pack s
  in encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeDynamicValue (SArray vec) = do
  elems <- traverse weakGetVar (V.toList vec)
  encoded <- abiEncode elems
  pure $ encodeUint256 (fromIntegral $ length elems) <> encoded
encodeDynamicValue v = pure $ encodeStaticValue v

-- | Standard ABI encoding of a list of values.
-- Uses head/tail encoding: static values go directly in the head,
-- dynamic values get an offset pointer in the head and data in the tail.
abiEncode :: MonadSM m => [Value] -> m B.ByteString
abiEncode vals = do
  let n = length vals
      headSize = n * 32
      -- Build head and tail simultaneously
      go [] _ headAcc tailAcc = pure (headAcc, tailAcc)
      go (v:vs) tailOffset headAcc tailAcc
        | isDynamicValue v = do
            encoded <- encodeDynamicValue v
            let offsetWord = encodeUint256 (fromIntegral tailOffset)
            go vs (tailOffset + B.length encoded) (headAcc <> offsetWord) (tailAcc <> encoded)
        | otherwise =
            go vs tailOffset (headAcc <> encodeStaticValue v) tailAcc
  uncurry (<>) <$> go vals headSize B.empty B.empty

-- | Packed ABI encoding — no padding, no offsets.
abiEncodePacked :: MonadSM m => [Value] -> m B.ByteString
abiEncodePacked = fmap fold . traverse encodeValuePacked
  where
    encodeValuePacked :: MonadSM m => Value -> m B.ByteString
    encodeValuePacked (SBool True)       = pure $ B.singleton 1
    encodeValuePacked (SBool False)      = pure $ B.singleton 0
    encodeValuePacked (SAddress addr _)  = pure $ addressToByteString addr
    encodeValuePacked (SInteger n)       = pure $ encodeInt256 n
    encodeValuePacked (SString s)        = pure $ BC.pack s
    encodeValuePacked (SBytes bs)        = pure bs
    encodeValuePacked (SEnumVal _ _ w)   = pure $ encodeUint256 (fromIntegral w)
    encodeValuePacked (SArray vec)       = fold <$> traverse (encodeValuePacked <=< weakGetVar) vec
    encodeValuePacked SNULL              = pure B.empty
    encodeValuePacked _                  = pure B.empty
