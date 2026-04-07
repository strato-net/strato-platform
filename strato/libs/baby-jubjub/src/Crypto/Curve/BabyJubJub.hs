{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DeriveGeneric #-}

-- |
-- Module      : Crypto.Curve.BabyJubJub
-- Description : Baby JubJub elliptic curve implementation
-- Copyright   : (c) BlockApps, 2026
-- License     : MIT
-- Maintainer  : info@blockapps.net
-- Stability   : experimental
--
-- Baby JubJub is a twisted Edwards curve defined over the BN254 scalar field.
-- It is widely used in zkSNARK applications for efficient in-circuit operations.
--
-- Curve equation: ax² + y² = 1 + dx²y²
--
-- References:
--   - EIP-2494: https://eips.ethereum.org/EIPS/eip-2494
--   - circomlib: https://github.com/iden3/circomlib

module Crypto.Curve.BabyJubJub
  ( -- * Types
    Point(..)
  , Fr
    -- * Constants
  , fieldPrime
  , curveA
  , curveD
  , subgroupOrder
  , cofactor
  , basePoint
  , basePointX
  , basePointY
    -- * Point operations
  , isOnCurve
  , pointAdd
  , pointDouble
  , pointNegate
  , scalarMult
  , scalarMultBase
    -- * Field operations
  , modP
  , modInverse
  , modSqrt
    -- * Point construction
  , mkPoint
  , mkPointUnsafe
  , pointFromY
  , identity
    -- * Serialization
  , pointToBytes
  , pointFromBytes
  , compressPoint
  , decompressPoint
  ) where

import Data.Bits (shiftL, shiftR, xor, (.&.))
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import GHC.Generics (Generic)

-- | Field element type (integers mod p)
type Fr = Integer

-- | Baby JubJub field prime (BN254 scalar field order)
-- p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
fieldPrime :: Integer
fieldPrime = 21888242871839275222246405745257275088548364400416034343698204186575808495617

-- | Curve coefficient a = 168700
curveA :: Integer
curveA = 168700

-- | Curve coefficient d = 168696
curveD :: Integer
curveD = 168696

-- | Subgroup order (prime order subgroup)
-- l = 2736030358979909402780800718157159386076813972158567259200215660948447373041
subgroupOrder :: Integer
subgroupOrder = 2736030358979909402780800718157159386076813972158567259200215660948447373041

-- | Cofactor h = 8
cofactor :: Integer
cofactor = 8

-- | Base point X coordinate (generator)
-- From circomlib: 5299619240641551281634865583518297030282874472190772894086521144482721001553
basePointX :: Integer
basePointX = 5299619240641551281634865583518297030282874472190772894086521144482721001553

-- | Base point Y coordinate (generator)
-- From circomlib: 16950150798460657717958625567821834550301663161624707787222815936182638968203
basePointY :: Integer
basePointY = 16950150798460657717958625567821834550301663161624707787222815936182638968203

-- | A point on the Baby JubJub curve
data Point 
  = Point !Integer !Integer  -- ^ Affine point (x, y)
  | Infinity                 -- ^ Point at infinity (identity)
  deriving (Show, Eq, Generic)

-- | Base point (generator of the prime-order subgroup)
basePoint :: Point
basePoint = Point basePointX basePointY

-- | Identity element (point at infinity)
-- For twisted Edwards curves, the identity is (0, 1)
identity :: Point
identity = Point 0 1

-- | Reduce an integer modulo the field prime
modP :: Integer -> Integer
modP x = x `mod` fieldPrime

-- | Compute modular inverse using extended Euclidean algorithm
modInverse :: Integer -> Integer
modInverse a = modP $ go fieldPrime (modP a) 0 1
  where
    go _ 0 _ _ = error "modInverse: no inverse exists"
    go _ 1 _ t = t
    go r0 r1 t0 t1 =
      let q = r0 `div` r1
          r2 = r0 - q * r1
          t2 = t0 - q * t1
      in go r1 r2 t1 t2

-- | Compute modular square root (Tonelli-Shanks)
-- Returns Nothing if no square root exists
modSqrt :: Integer -> Maybe Integer
modSqrt n
  | n == 0 = Just 0
  | legendreSymbol n /= 1 = Nothing
  | otherwise = Just $ tonelliShanks n
  where
    -- Legendre symbol: n^((p-1)/2) mod p
    legendreSymbol x = modExp x ((fieldPrime - 1) `div` 2) fieldPrime
    
    -- Tonelli-Shanks algorithm
    tonelliShanks a =
      let -- Factor out powers of 2 from p-1
          (q, s) = factorPowers2 (fieldPrime - 1)
          -- Find quadratic non-residue
          z = findNonResidue 2
          -- Initial values
          m0 = s :: Integer
          c0 = modExp z q fieldPrime
          t0 = modExp a q fieldPrime
          r0 = modExp a ((q + 1) `div` 2) fieldPrime
      in loop m0 c0 t0 r0
      where
        factorPowers2 :: Integer -> (Integer, Integer)
        factorPowers2 x = go x 0
          where
            go v e
              | even v = go (v `div` 2) (e + 1)
              | otherwise = (v, e)
        
        findNonResidue z
          | legendreSymbol z /= 1 = z
          | otherwise = findNonResidue (z + 1)
        
        loop _ _ 1 r = r
        loop m c t r =
          let -- Find least i such that t^(2^i) = 1
              i = findI t 1
              b = modExp c (2 ^ (m - i - 1)) fieldPrime
              m' = i
              c' = modP (b * b)
              t' = modP (t * c')
              r' = modP (r * b)
          in loop m' c' t' r'
          where
            findI tv k
              | modExp tv (2 ^ k) fieldPrime == 1 = k
              | otherwise = findI tv (k + 1)

-- | Modular exponentiation (square-and-multiply)
modExp :: Integer -> Integer -> Integer -> Integer
modExp base expo m = go base expo 1
  where
    go _ 0 !acc = acc
    go !b !e !acc
      | e `mod` 2 == 1 = go ((b * b) `mod` m) (e `div` 2) ((acc * b) `mod` m)
      | otherwise = go ((b * b) `mod` m) (e `div` 2) acc

-- | Check if a point is on the curve: ax² + y² = 1 + dx²y²
isOnCurve :: Point -> Bool
isOnCurve Infinity = True
isOnCurve (Point x y) =
  let x2 = modP (x * x)
      y2 = modP (y * y)
      lhs = modP (curveA * x2 + y2)
      rhs = modP (1 + curveD * x2 * y2)
  in lhs == rhs

-- | Create a point, checking it's on the curve
mkPoint :: Integer -> Integer -> Maybe Point
mkPoint x y
  | isOnCurve p = Just p
  | otherwise = Nothing
  where p = Point (modP x) (modP y)

-- | Create a point without checking (use with caution)
mkPointUnsafe :: Integer -> Integer -> Point
mkPointUnsafe x y = Point (modP x) (modP y)

-- | Create a point from Y coordinate, recovering X
-- The sign parameter selects which of the two possible X values
-- When sign=false, return x where x*2 <= p (the "positive" or small x)
-- When sign=true, return x where x*2 > p (the "negative" or large x)
pointFromY :: Integer -> Bool -> Maybe Point
pointFromY y wantLargeX = do
  let y2 = modP (y * y)
      -- From curve equation ax² + y² = 1 + dx²y²:
      -- x²(a - dy²) = 1 - y²
      -- x² = (1 - y²) / (a - dy²)
      numerator = modP (1 - y2)
      denominator = modP (curveA - curveD * y2)
  
  -- Check denominator is non-zero
  if denominator == 0
    then Nothing
    else do
      let x2 = modP (numerator * modInverse denominator)
      xSqrt <- modSqrt x2
      -- xSqrt is one of the two square roots; (p - xSqrt) is the other
      -- We want to return the "large" one (x*2 > p) if wantLargeX is true
      let xSmall = if xSqrt * 2 <= fieldPrime then xSqrt else modP (fieldPrime - xSqrt)
          xLarge = modP (fieldPrime - xSmall)
          x = if wantLargeX then xLarge else xSmall
      return $ Point x (modP y)

-- | Add two points on the curve
-- Using the unified addition formula for twisted Edwards curves:
-- x3 = (x1*y2 + y1*x2) / (1 + d*x1*x2*y1*y2)
-- y3 = (y1*y2 - a*x1*x2) / (1 - d*x1*x2*y1*y2)
pointAdd :: Point -> Point -> Point
pointAdd Infinity p = p
pointAdd p Infinity = p
pointAdd (Point x1 y1) (Point x2 y2) =
  let x1x2 = modP (x1 * x2)
      y1y2 = modP (y1 * y2)
      x1y2 = modP (x1 * y2)
      y1x2 = modP (y1 * x2)
      dxy = modP (curveD * x1x2 * y1y2)
      
      x3Num = modP (x1y2 + y1x2)
      x3Den = modP (1 + dxy)
      
      y3Num = modP (y1y2 - curveA * x1x2)
      y3Den = modP (1 - dxy)
      
      x3 = modP (x3Num * modInverse x3Den)
      y3 = modP (y3Num * modInverse y3Den)
  in Point x3 y3

-- | Double a point (more efficient than pointAdd p p)
pointDouble :: Point -> Point
pointDouble Infinity = Infinity
pointDouble p@(Point _ _) = pointAdd p p  -- Use unified formula

-- | Negate a point: -(x, y) = (-x, y)
pointNegate :: Point -> Point
pointNegate Infinity = Infinity
pointNegate (Point x y) = Point (modP (fieldPrime - x)) y

-- | Scalar multiplication using double-and-add
scalarMult :: Integer -> Point -> Point
scalarMult n p
  | n == 0 = identity
  | n < 0 = scalarMult (negate n) (pointNegate p)
  | otherwise = go n p identity
  where
    go 0 _ !acc = acc
    go !k !q !acc
      | k `mod` 2 == 1 = go (k `div` 2) (pointDouble q) (pointAdd acc q)
      | otherwise = go (k `div` 2) (pointDouble q) acc

-- | Scalar multiplication with the base point
scalarMultBase :: Integer -> Point
scalarMultBase n = scalarMult n basePoint

-- | Serialize a point to 64 bytes (32 bytes each for x and y, big-endian)
pointToBytes :: Point -> ByteString
pointToBytes Infinity = BS.replicate 64 0
pointToBytes (Point x y) = integerToBytes32 x <> integerToBytes32 y

-- | Deserialize a point from 64 bytes
pointFromBytes :: ByteString -> Maybe Point
pointFromBytes bs
  | BS.length bs /= 64 = Nothing
  | bs == BS.replicate 64 0 = Just identity
  | otherwise =
      let (xBytes, yBytes) = BS.splitAt 32 bs
          x = bytes32ToInteger xBytes
          y = bytes32ToInteger yBytes
      in mkPoint x y

-- | Compress a point to 32 bytes (Y coordinate with sign bit)
compressPoint :: Point -> ByteString
compressPoint Infinity = BS.replicate 32 0
compressPoint (Point x y) =
  let yBytes = integerToBytes32 y
      -- Set high bit of first byte if x is "negative" (x > p/2)
      signBit = if x * 2 > fieldPrime then 0x80 else 0x00
      firstByte = (BS.head yBytes) `xor` signBit
  in BS.cons firstByte (BS.tail yBytes)

-- | Decompress a point from 32 bytes
decompressPoint :: ByteString -> Maybe Point
decompressPoint bs
  | BS.length bs /= 32 = Nothing
  | bs == BS.replicate 32 0 = Just identity
  | otherwise =
      let signBit = (BS.head bs .&. 0x80) /= 0
          yBytes = BS.cons (BS.head bs .&. 0x7F) (BS.tail bs)
          y = bytes32ToInteger yBytes
      in pointFromY y signBit

-- | Convert Integer to 32-byte big-endian ByteString
integerToBytes32 :: Integer -> ByteString
integerToBytes32 n = BS.pack $ map getByte [31, 30..0]
  where
    getByte i = fromIntegral ((n `shiftR` (i * 8)) .&. 0xFF)

-- | Convert 32-byte big-endian ByteString to Integer
bytes32ToInteger :: ByteString -> Integer
bytes32ToInteger bs = BS.foldl' (\acc b -> acc `shiftL` 8 + fromIntegral b) 0 bs
