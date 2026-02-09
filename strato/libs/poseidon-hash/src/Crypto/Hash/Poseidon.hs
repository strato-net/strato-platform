{-# LANGUAGE BangPatterns #-}
-- |
-- Module      : Crypto.Hash.Poseidon
-- Description : Poseidon hash function for ZK-SNARKs
-- 
-- A pure Haskell implementation of the Poseidon hash function,
-- designed for efficient computation inside ZK-SNARK circuits.
-- 
-- This implementation uses the BN254 (alt_bn128) scalar field and
-- follows the reference implementation from circomlibjs.
--
-- Example usage:
--
-- @
-- import Crypto.Hash.Poseidon
-- 
-- -- Hash two field elements
-- let result = poseidon [toF 1, toF 2]
-- @

module Crypto.Hash.Poseidon
  ( -- * Main hash function
    poseidon
  , poseidonN
    -- * Re-exports from Field
  , F
  , toF
  , fromF
  , fromHex
  , toHex
  , fieldPrime
  , fAdd
  , fMul
  , fPow
  ) where

import Crypto.Hash.Poseidon.Field
import Crypto.Hash.Poseidon.Constants

import Data.Vector (Vector)
import qualified Data.Vector as V

-- | Poseidon hash function
-- 
-- Takes a list of 1-8 field elements and returns a single field element.
-- This is the standard Poseidon hash with a single output.
poseidon :: [F] -> F
poseidon inputs = V.head $ poseidonN inputs 1

-- | Poseidon hash with multiple outputs
--
-- Takes a list of 1-8 field elements and returns the specified number
-- of output field elements.
poseidonN :: [F] -> Int -> Vector F
poseidonN inputs nOut
  | null inputs = error "Poseidon: at least one input required"
  | length inputs > 8 = error "Poseidon: at most 8 inputs supported"
  | otherwise = V.take nOut finalState
  where
    t = length inputs + 1  -- state size
    tIdx = t - 2           -- index into constants arrays
    
    nRF = nRoundsF         -- full rounds (always 8)
    nRP = nRoundsP V.! tIdx -- partial rounds (varies by t)
    
    c = roundConstants V.! tIdx  -- round constants for this t
    m = mdsMatrix V.! tIdx       -- MDS matrix for this t
    
    -- Initial state: [0, input1, input2, ...]
    initState = V.fromList (toF 0 : inputs)
    
    -- Apply all rounds
    finalState = applyRounds initState nRF nRP c m t

-- | Apply all Poseidon rounds
applyRounds :: Vector F -> Int -> Int -> Vector F -> Vector (Vector F) -> Int -> Vector F
applyRounds !state nRF nRP c m t = go state 0
  where
    totalRounds = nRF + nRP
    halfF = nRF `div` 2
    
    go !s !r
      | r >= totalRounds = s
      | otherwise = 
          let -- 1. Add round constants
              sWithC = V.imap (\i x -> fAdd x (c V.! (r * t + i))) s
              -- 2. Apply S-box
              sAfterSbox = applySbox sWithC r
              -- 3. Apply MDS matrix
              sAfterMDS = mdsMultiply m sAfterSbox
          in go sAfterMDS (r + 1)
    
    -- S-box: x^5
    -- In full rounds, apply to all elements
    -- In partial rounds, apply only to first element
    applySbox sC roundIdx
      | roundIdx < halfF || roundIdx >= halfF + nRP = 
          -- Full round: S-box on all elements
          V.map pow5 sC
      | otherwise = 
          -- Partial round: S-box only on first element
          sC V.// [(0, pow5 (sC V.! 0))]
    
    pow5 x = fMul x (fMul (fMul x x) (fMul x x))

-- | MDS matrix multiplication
mdsMultiply :: Vector (Vector F) -> Vector F -> Vector F
mdsMultiply m v = V.imap (\i _ -> dotProduct (m V.! i) v) v
  where
    dotProduct row vec = V.foldl' fAdd (toF 0) (V.zipWith fMul row vec)
