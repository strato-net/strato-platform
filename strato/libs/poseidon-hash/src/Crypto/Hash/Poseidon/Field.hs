{-# LANGUAGE BangPatterns #-}
-- |
-- Module      : Crypto.Hash.Poseidon.Field
-- Description : BN254 scalar field arithmetic for Poseidon hash
-- 
-- This module provides modular arithmetic operations over the BN254
-- (alt_bn128) scalar field, which is used by Ethereum's pairing precompiles
-- and most ZK-SNARK implementations.

module Crypto.Hash.Poseidon.Field
  ( -- * Types
    F
  , toF
  , fromF
    -- * Field parameters
  , fieldPrime
    -- * Arithmetic operations
  , fAdd
  , fSub
  , fMul
  , fPow
  , fNeg
  , fInv
    -- * Conversion
  , fromHex
  , toHex
  ) where

import Data.Bits (shiftR)
import Numeric (showHex, readHex)

-- | The BN254 scalar field prime (also known as the "SNARK scalar field")
-- This is the order of the BN254 curve's scalar field.
-- p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
fieldPrime :: Integer
fieldPrime = 21888242871839275222246405745257275088548364400416034343698204186575808495617

-- | Field element - a wrapper around Integer with modular arithmetic
newtype F = F { unF :: Integer }
  deriving (Eq, Ord)

instance Show F where
  show (F n) = "0x" ++ showHex n ""

-- | Create a field element, reducing modulo the field prime
toF :: Integer -> F
toF n = F (n `mod` fieldPrime)

-- | Extract the integer value from a field element
fromF :: F -> Integer
fromF = unF

-- | Field addition
fAdd :: F -> F -> F
fAdd (F a) (F b) = F ((a + b) `mod` fieldPrime)

-- | Field subtraction
fSub :: F -> F -> F
fSub (F a) (F b) = F ((a - b) `mod` fieldPrime)

-- | Field multiplication
fMul :: F -> F -> F
fMul (F a) (F b) = F ((a * b) `mod` fieldPrime)

-- | Field negation
fNeg :: F -> F
fNeg (F a) = F ((fieldPrime - a) `mod` fieldPrime)

-- | Field exponentiation using square-and-multiply
fPow :: F -> Integer -> F
fPow _ 0 = F 1
fPow (F base) exp' = F (go base exp' 1)
  where
    go _ 0 !acc = acc
    go !b !e !acc
      | odd e     = go ((b * b) `mod` fieldPrime) (e `shiftR` 1) ((acc * b) `mod` fieldPrime)
      | otherwise = go ((b * b) `mod` fieldPrime) (e `shiftR` 1) acc

-- | Field multiplicative inverse using Fermat's little theorem
-- a^(-1) = a^(p-2) mod p
fInv :: F -> F
fInv a = fPow a (fieldPrime - 2)

-- | Parse a hex string (with or without 0x prefix) to a field element
fromHex :: String -> F
fromHex s = toF $ case readHex (dropPrefix s) of
  [(n, "")] -> n
  _         -> error $ "Invalid hex string: " ++ s
  where
    dropPrefix ('0':'x':rest) = rest
    dropPrefix ('0':'X':rest) = rest
    dropPrefix other          = other

-- | Convert a field element to a hex string with 0x prefix
toHex :: F -> String
toHex (F n) = "0x" ++ padLeft 64 '0' (showHex n "")
  where
    padLeft len c str = replicate (len - length str) c ++ str
