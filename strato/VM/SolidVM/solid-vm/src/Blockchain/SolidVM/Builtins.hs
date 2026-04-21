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
    abiEncodeWithSelector,
    abiEncodeWithSignature,
    abiEncodeCall,

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
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
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
  -- Ethereum orders the coordinates as x1, y1, x2Imag, x2Real, y2Imag, y2Real
  -- so toTrios regroups them to ((x1, y1), (x2Real, x2Imag), (y2Real, y2Imag)),
  -- which is the order in which pairing library (and poly library under the hood) expects
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

-- | Poseidon hash - ZK-friendly hash function over BN254 scalar field
-- Takes a list of integers (field elements) and returns their Poseidon hash
poseidonHash :: [Integer] -> Integer
poseidonHash inputs = Poseidon.fromF $ Poseidon.poseidon (map Poseidon.toF inputs)

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

-- | abi.encodeWithSelector(selector, ...args) — prepend an explicit 4-byte
-- selector to the ABI-encoded argument list.
abiEncodeWithSelector :: MonadSM m => [Value] -> m B.ByteString
abiEncodeWithSelector (selVal : rest) = do
  let selector = B.take 4 $ selectorBytes selVal
  flat <- flattenTupleValues rest
  encoded <- abiEncode flat
  pure $ selector <> encoded
abiEncodeWithSelector args =
  invalidArguments "abi.encodeWithSelector expects (bytes4, ...)" args

-- | abi.encodeWithSignature(sig, ...args) — compute the selector as the
-- first 4 bytes of keccak256(sig), then ABI-encode the remaining args.
abiEncodeWithSignature :: MonadSM m => [Value] -> m B.ByteString
abiEncodeWithSignature (SString sig : rest) = do
  let selector = B.take 4 . keccak256ToByteString . hash $ BC.pack sig
  flat <- flattenTupleValues rest
  encoded <- abiEncode flat
  pure $ selector <> encoded
abiEncodeWithSignature args =
  invalidArguments "abi.encodeWithSignature expects (string, ...)" args

-- | abi.encodeCall(function, (args...)) — derive a selector from the
-- function reference's name and ABI-encode the tuple of arguments. SolidVM
-- lacks the full Solidity signature during encoding, so we fall back to
-- keccak256 of just the function name; low-level dispatch in SolidVM does
-- not rely on the selector, so this is only observable if a caller decodes
-- the bytes themselves.
abiEncodeCall :: MonadSM m => [Value] -> m B.ByteString
abiEncodeCall (fn : rest) = do
  let selector = B.take 4 . keccak256ToByteString . hash . BC.pack $ functionReferenceName fn
  flat <- flattenTupleValues rest
  encoded <- abiEncode flat
  pure $ selector <> encoded
abiEncodeCall args =
  invalidArguments "abi.encodeCall expects (function, args)" args

-- | Extract an explicit selector from a bytes/string value; used by
-- abi.encodeWithSelector so callers can pass either a bytes4 literal or a
-- precomputed string of selector bytes.
selectorBytes :: Value -> B.ByteString
selectorBytes (SBytes bs) = bs
selectorBytes (SString s) = BC.pack s
selectorBytes (SInteger n) = encodeUint256 n
selectorBytes _ = B.replicate 4 0

functionReferenceName :: Value -> String
functionReferenceName (SFunction name _)         = name
functionReferenceName (SContractFunction _ name) = name
functionReferenceName _                          = ""

-- | Solidity tuple literals like @(a, b)@ reach builtins as a single
-- @STuple@ value; flatten one level so @abiEncode@ treats them as
-- positional args.
flattenTupleValues :: MonadSM m => [Value] -> m [Value]
flattenTupleValues = fmap concat . traverse flatten
  where
    flatten :: MonadSM m => Value -> m [Value]
    flatten (STuple vec) = traverse weakGetVar (V.toList vec)
    flatten v = pure [v]
