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

    -- * Non-ABI builtins — pre-audit behaviour
    push,
    modExp,
    ecAdd,
    ecMul,
    ecPairing,
    poseidonHash,

    -- * Non-ABI builtins — post-audit behaviour (fork-gated via
    --   'Blockchain.VM.ForkGate.isAuditForkActive'). Callers pick one
    --   variant based on the current chain height.
    modExpPostAudit,
    ecAddPostAudit,
    ecMulPostAudit,
    ecPairingPostAudit,
    poseidonHashPostAudit,
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

-- | Pre-audit modExp. The audit (findings 3 and 32) identified two issues:
-- an unguarded divide-by-zero when @m == 0@, and an operator-precedence
-- bug in the odd-exponent branch plus a @0^0@ mismatch with the EVM
-- MODEXP precompile. Fixing any of them changes the arithmetic result
-- that on-chain state was built on — so the fix must be fork-gated, not
-- applied unconditionally.
modExp :: Integer -> Integer -> Integer -> Integer
modExp b e m =
  case (b, e, even e) of
    (0, _, _) -> 0
    (_, 0, _) -> 1
    (_, _, True) ->
      let y = modExp b (e `div` 2) m
        in (y * y) `mod` m
    (_, _, False) ->
      b * (modExp b (e - 1) m) `mod` m

-- NOTE: audit findings 1, 11, 49, and 50 call for rejecting off-curve /
-- out-of-field inputs and empty-list inputs in the BN254 primitives
-- (ecAdd / ecMul / ecPairing / poseidonHash). Doing so would revert
-- transactions that previously succeeded with garbage cryptographic
-- output; fork-gate the validation before re-enabling.
point :: (Integer, Integer) -> Point Weierstrass Affine BN254 Fq Fr
point (x, y) =
  if x == 0 && y == 0
    then O
    else A (fromInteger x :: Fq) (fromInteger y :: Fq)

unpoint :: Point Weierstrass Affine BN254 Fq Fr -> (Integer, Integer)
unpoint (A x y) = (toInteger x, toInteger y)
unpoint O       = (0, 0)

ecAdd :: (Integer, Integer) -> (Integer, Integer) -> (Integer, Integer)
ecAdd p1 p2 = unpoint (add @Weierstrass @Affine @BN254 @Fq @Fr (point p1) (point p2))

ecMul :: (Integer, Integer) -> Integer -> (Integer, Integer)
ecMul p s = unpoint (mul @Weierstrass @Affine @BN254 (point p) (fromInteger s :: Fr))

ecPairing :: [Integer] -> Bool
ecPairing = maybe False doPairing . toTrios
  where toTrios (a:b:c:d:e:f:g) = (((a,b),(d,c),(f,e)):) <$> toTrios g
        toTrios [] = Just []
        toTrios _ = Nothing
        doPairing trios =
          let toFq2 :: (Integer,Integer) -> Fq2
              toFq2 (u,v) = fromList [fromInteger u, fromInteger v]

              toG2 :: ((Integer,Integer), (Integer,Integer)) -> G2'
              toG2 (x2,y2) = A (toFq2 x2) (toFq2 y2)

              acc :: GT'
              acc = mconcat [pairing (point g1) (toG2 (x2,y2)) | (g1,x2,y2) <- trios]

           in acc == mempty

poseidonHash :: [Integer] -> Integer
poseidonHash inputs = Poseidon.fromF $ Poseidon.poseidon (map Poseidon.toF inputs)

--------------------------------------------------------------------------------
-- Post-audit variants. See 'Blockchain.VM.ForkGate' for the gating.

-- BN254 (alt_bn128) field prime.
bn254FieldPrime :: Integer
bn254FieldPrime = 21888242871839275222246405745257275088696311157297823662689037894645226208583

-- BN254 scalar field order (used by Poseidon).
bn254ScalarOrder :: Integer
bn254ScalarOrder = 21888242871839275222246405745257275088548364400416034343698204186575808495617

-- | Post-audit: guard against @m == 0@ (EVM MODEXP returns 0), fix the
-- @0^0 mod m@ result, and parenthesise the odd-exponent case so the
-- intermediate product is reduced modulo @m@ (finding 32).
modExpPostAudit :: Integer -> Integer -> Integer -> Integer
modExpPostAudit _ _ 0 = 0
modExpPostAudit b e m =
  case (e, even e) of
    (0, _) -> 1 `mod` m
    _ | b == 0 -> 0
    (_, True) ->
      let y = modExpPostAudit b (e `div` 2) m
       in (y * y) `mod` m
    (_, False) ->
      (b * modExpPostAudit b (e - 1) m) `mod` m

-- | Post-audit: reject coordinates that aren't on the G1 curve (finding 11).
pointCheckedPostAudit :: (Integer, Integer) -> Maybe (Point Weierstrass Affine BN254 Fq Fr)
pointCheckedPostAudit (0, 0) = Just O
pointCheckedPostAudit (x, y)
  | isOnG1 x y = Just (A (fromInteger x :: Fq) (fromInteger y :: Fq))
  | otherwise = Nothing
  where
    isOnG1 a c =
      let p = bn254FieldPrime
       in a >= 0 && a < p && c >= 0 && c < p
            && ((c * c - a * a * a - 3) `mod` p == 0)

isOnG2PostAudit :: (Integer, Integer) -> (Integer, Integer) -> Bool
isOnG2PostAudit (xr, xi) (yr, yi) =
  let p = bn254FieldPrime
      inFq a = a >= 0 && a < p
   in inFq xr && inFq xi && inFq yr && inFq yi

-- | Post-audit: return @Nothing@ if either input is off-curve.
ecAddPostAudit :: (Integer, Integer) -> (Integer, Integer) -> Maybe (Integer, Integer)
ecAddPostAudit p1 p2 = do
  q1 <- pointCheckedPostAudit p1
  q2 <- pointCheckedPostAudit p2
  pure . unpoint $ add @Weierstrass @Affine @BN254 @Fq @Fr q1 q2

ecMulPostAudit :: (Integer, Integer) -> Integer -> Maybe (Integer, Integer)
ecMulPostAudit p s = do
  q <- pointCheckedPostAudit p
  pure . unpoint $ mul @Weierstrass @Affine @BN254 q (fromInteger s :: Fr)

-- | Post-audit: reject empty input, input whose length isn't a positive
-- multiple of 6, and off-curve / out-of-field coordinates. Callers
-- should treat @Nothing@ as a revert (findings 1, 50).
ecPairingPostAudit :: [Integer] -> Maybe Bool
ecPairingPostAudit xs = do
  trios <- toTrios xs
  case trios of
    [] -> Nothing
    _ -> doPairing trios
  where
    toTrios (a : b : c : d : e : f : g) = (((a, b), (d, c), (f, e)) :) <$> toTrios g
    toTrios [] = Just []
    toTrios _ = Nothing

    toFq2 :: (Integer, Integer) -> Fq2
    toFq2 (u, v) = fromList [fromInteger u, fromInteger v]

    toG2 :: ((Integer, Integer), (Integer, Integer)) -> G2'
    toG2 (x2, y2) = A (toFq2 x2) (toFq2 y2)

    validateTrio (g1, x2, y2) = do
      p1 <- pointCheckedPostAudit g1
      if isOnG2PostAudit x2 y2 then Just (p1, toG2 (x2, y2)) else Nothing

    doPairing trios = do
      pairs <- traverse validateTrio trios
      let acc :: GT'
          acc = mconcat [pairing p1 g2 | (p1, g2) <- pairs]
      pure (acc == mempty)

-- | Post-audit: reject inputs outside the BN254 scalar field so that
-- @poseidonHash x@ and @poseidonHash (x + p)@ do not collide (finding 49).
poseidonHashPostAudit :: [Integer] -> Maybe Integer
poseidonHashPostAudit inputs
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
