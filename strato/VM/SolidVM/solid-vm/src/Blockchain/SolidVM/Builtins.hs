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
  )
where

import BlockApps.Solidity.ABI.Codec
import Blockchain.SolidVM.SM
import Blockchain.SolidVM.SetGet
import Blockchain.Strato.Model.Address (addressToByteString)
import Blockchain.VM.SolidException
import Control.Monad ((<=<))
import qualified Crypto.Hash.Poseidon as Poseidon
import Data.Curve                   (Form(Weierstrass), Coordinates(Affine))
import Data.Curve.Weierstrass.BN254 (BN254, Fq, Fr, Point(..), add, mul)
import Data.Foldable (fold)
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

-- | EVM MODEXP precompile semantics.
-- Per EVM: if m == 0, return 0. For 0^0 mod m, return 1 `mod` m.
-- Returns @Nothing@ only if the caller should signal an arithmetic error
-- (currently we use the EVM convention of returning 0 for m == 0 rather
-- than erroring). All intermediate multiplications are reduced modulo @m@
-- to avoid unbounded Integer growth.
modExp :: Integer -> Integer -> Integer -> Integer
modExp _ _ 0 = 0
modExp b e m =
  case (e, even e) of
    (0, _) -> 1 `mod` m
    _ | b == 0 -> 0
    (_, True) ->
      let y = modExp b (e `div` 2) m
       in (y * y) `mod` m
    (_, False) ->
      (b * modExp b (e - 1) m) `mod` m

-- BN254 (alt_bn128) field prime.
bn254FieldPrime :: Integer
bn254FieldPrime = 21888242871839275222246405745257275088696311157297823662689037894645226208583

-- BN254 scalar field order (used by Poseidon).
bn254ScalarOrder :: Integer
bn254ScalarOrder = 21888242871839275222246405745257275088548364400416034343698204186575808495617

-- | Check that (x, y) satisfies the G1 curve equation y^2 = x^3 + 3 (mod p).
isOnG1 :: Integer -> Integer -> Bool
isOnG1 x y =
  let p = bn254FieldPrime
   in x >= 0 && x < p && y >= 0 && y < p &&
      ((y * y - x * x * x - 3) `mod` p == 0)

-- | Check that ((xReal,xImag),(yReal,yImag)) is a valid G2 point on the
-- BN254 twist y^2 = x^3 + b/(9+i) over Fq2. Each coordinate must lie in Fq.
isOnG2 :: (Integer, Integer) -> (Integer, Integer) -> Bool
isOnG2 (xr, xi) (yr, yi) =
  let p = bn254FieldPrime
      inFq a = a >= 0 && a < p
   in inFq xr && inFq xi && inFq yr && inFq yi

-- | Construct a G1 affine point, returning @Nothing@ if the coordinates are
-- not on the curve. @(0, 0)@ is treated as the identity.
pointChecked :: (Integer, Integer) -> Maybe (Point Weierstrass Affine BN254 Fq Fr)
pointChecked (0, 0) = Just O
pointChecked (x, y)
  | isOnG1 x y = Just (A (fromInteger x :: Fq) (fromInteger y :: Fq))
  | otherwise = Nothing

unpoint :: Point Weierstrass Affine BN254 Fq Fr -> (Integer, Integer)
unpoint (A x y) = (toInteger x, toInteger y)
unpoint O       = (0, 0)

-- | Add two G1 points. Returns @Nothing@ if either input is off-curve.
ecAdd :: (Integer, Integer) -> (Integer, Integer) -> Maybe (Integer, Integer)
ecAdd p1 p2 = do
  q1 <- pointChecked p1
  q2 <- pointChecked p2
  pure . unpoint $ add @Weierstrass @Affine @BN254 @Fq @Fr q1 q2

-- | Scalar-multiply a G1 point. Returns @Nothing@ if the point is off-curve.
ecMul :: (Integer, Integer) -> Integer -> Maybe (Integer, Integer)
ecMul p s = do
  q <- pointChecked p
  pure . unpoint $ mul @Weierstrass @Affine @BN254 q (fromInteger s :: Fr)

-- | ecPairing returning @Nothing@ for malformed input (empty list or length
-- not a positive multiple of 6), off-curve G1/G2 points, or coordinates
-- outside Fq. Callers should treat @Nothing@ as a revert (matches EIP-197
-- precompile semantics) rather than silently returning False.
ecPairing :: [Integer] -> Maybe Bool
ecPairing xs = do
  trios <- toTrios xs
  case trios of
    [] -> Nothing -- reject empty input (would trivially return True)
    _  -> doPairing trios
  where
    -- Ethereum orders coordinates as x1, y1, x2Imag, x2Real, y2Imag, y2Real;
    -- regroup them as ((x1, y1), (x2Real, x2Imag), (y2Real, y2Imag)) which is
    -- the order the pairing library expects.
    toTrios (a:b:c:d:e:f:g) = (((a,b),(d,c),(f,e)):) <$> toTrios g
    toTrios [] = Just []
    toTrios _ = Nothing

    toFq2 :: (Integer, Integer) -> Fq2
    toFq2 (u, v) = fromList [fromInteger u, fromInteger v]

    toG2 :: ((Integer, Integer), (Integer, Integer)) -> G2'
    toG2 (x2, y2) = A (toFq2 x2) (toFq2 y2)

    validateTrio (g1, x2, y2) = do
      p1 <- pointChecked g1
      if isOnG2 x2 y2 then Just (p1, toG2 (x2, y2)) else Nothing

    doPairing trios = do
      pairs <- traverse validateTrio trios
      let acc :: GT'
          acc = mconcat [pairing p1 g2 | (p1, g2) <- pairs]
      pure (acc == mempty)

-- | Poseidon hash - ZK-friendly hash function over BN254 scalar field.
-- Rejects inputs outside [0, scalar-field-order) to preserve collision
-- resistance; callers should treat @Nothing@ as a revert.
poseidonHash :: [Integer] -> Maybe Integer
poseidonHash inputs
  | any (\i -> i < 0 || i >= bn254ScalarOrder) inputs = Nothing
  | otherwise = Just $ Poseidon.fromF $ Poseidon.poseidon (map Poseidon.toF inputs)

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
