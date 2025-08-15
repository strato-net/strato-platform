{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM.Builtins where

import Blockchain.SolidVM.SM
import Blockchain.SolidVM.SetGet
import Blockchain.VM.SolidException
import Data.Curve                   (Form(Weierstrass), Coordinates(Affine))
import Data.Curve.Weierstrass.BN254 (BN254, Fq, Fr, Point(..), add, mul)
import Data.Pairing                 (pairing)
import Data.Pairing.BN254           (Fq2, G1', G2', GT')
import qualified Data.Vector as V
import GHC.Exts (IsList(fromList))
import qualified SolidVM.Model.Storable as MS
import SolidVM.Model.Value

-- Pushes a new value to an array and returns the length of the new array
push :: MonadSM m => Value -> Maybe Variable -> ValList -> m Variable
push (SReference apt) _ (OrderedVals [av]) = do
  let lenPath = apt `apSnoc` MS.Field "length"
  len' <- getInt $ Constant $ SReference lenPath
  let len :: Int = fromIntegral len'
      newLen = SInteger $ fromIntegral $ len + 1
      idxPath = apt `apSnoc` MS.ArrayIndex len
  setVar (Constant (SReference lenPath)) newLen
  setVar (Constant (SReference idxPath)) av
  return $ Constant newLen
push (SArray vec) (Just (Variable ref)) (OrderedVals [av]) = do
  newVar <- createVar av
  let newArr = V.snoc vec newVar
  setVar (Variable ref) (SArray newArr)
  return $ Constant (SInteger $ fromIntegral $ V.length newArr)
push _ _ argVals = do
  invalidArguments "push" argVals

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

ecAdd :: (Integer, Integer) -> (Integer, Integer) -> (Integer, Integer)
ecAdd p1 p2 = unpoint (add @Weierstrass @Affine @BN254 @Fq @Fr (point p1) (point p2))
  where
    point   (x, y)  = A (fromInteger x :: Fq) (fromInteger y :: Fq)
    unpoint (A x y) = (toInteger x, toInteger y)
    unpoint _       = error "ecAdd: Non-affine point returned"

ecMul :: (Integer, Integer) -> Integer -> (Integer, Integer)
ecMul p s = unpoint (mul @Weierstrass @Affine @BN254 (point p) (fromInteger s :: Fr))
  where
    point   (x, y)   = A (fromInteger x :: Fq) (fromInteger y :: Fq)
    unpoint (A x y) = (toInteger x, toInteger y)
    unpoint _       = error "ecMul: Non-affine point returned"

ecPairing :: [(Integer, Integer)] -> Bool
ecPairing = maybe False doPairing . toTrios
  where toTrios (a:b:c:d) = ((a,b,c):) <$> toTrios d
        toTrios [] = Just []
        toTrios _ = Nothing
        doPairing trios =
          let toFq :: Integer -> Fq
              toFq = fromInteger

              toFq2 :: (Integer,Integer) -> Fq2
              toFq2 (u,v) = fromList [fromInteger u, fromInteger v]

              toG1 :: (Integer,Integer) -> G1'
              toG1 (x,y) = A (toFq x) (toFq y)

              toG2 :: ((Integer,Integer), (Integer,Integer)) -> G2'
              toG2 (x2,y2) = A (toFq2 x2) (toFq2 y2)

              acc :: GT'
              acc = mconcat [pairing (toG1 g1) (toG2 (x2,y2)) | (g1,x2,y2) <- trios]

           in acc == mempty