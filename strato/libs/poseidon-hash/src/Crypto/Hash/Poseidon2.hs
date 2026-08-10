-- |
-- Module      : Crypto.Hash.Poseidon2
-- Description : Poseidon2 permutation and hash (gnark-crypto BN254 parameters)
--
-- Poseidon2 over the BN254 scalar field with gnark-crypto's default
-- parameters (t=2, rF=6, rP=50, d=5): the permutation, the 2-to-1
-- compression (right-input feed-forward), and the Merkle–Damgård hash
-- built from it. Matches @consensys/gnark-crypto@'s @ecc/bn254/fr/poseidon2@
-- bit-for-bit, so digests agree with gnark circuits' @std/hash/poseidon2@
-- gadget.
module Crypto.Hash.Poseidon2
  ( permutation
  , compress
  , hash
  ) where

import Crypto.Hash.Poseidon.Field (F, fAdd, fMul, toF)
import Crypto.Hash.Poseidon2.Constants (roundKeys)
import Data.List (foldl')

halfFullRounds :: Int
halfFullRounds = 3

partialRounds :: Int
partialRounds = 50

rkF :: [(Int, [F])]
rkF = zip [0 ..] (map (map toF) roundKeys)

-- x^5
sbox :: F -> F
sbox x =
  let x2 = fMul x x
      x4 = fMul x2 x2
   in fMul x4 x

-- external linear layer, circ(2, 1): (2a+b, a+2b)
matE :: (F, F) -> (F, F)
matE (a, b) = let s = fAdd a b in (fAdd a s, fAdd b s)

-- internal linear layer, [[2,1],[1,3]]
matI :: (F, F) -> (F, F)
matI (a, b) = let s = fAdd a b in (fAdd a s, fAdd (fAdd b b) s)

permutation :: (F, F) -> (F, F)
permutation s0 = foldl' step (matE s0) rkF
  where
    step (a, b) (i, ks)
      | i < halfFullRounds || i >= halfFullRounds + partialRounds =
          case ks of
            [k0, k1] -> matE (sbox (fAdd a k0), sbox (fAdd b k1))
            _ -> error $ "Poseidon2: malformed full-round key at round " ++ show i
      | otherwise =
          case ks of
            [k0] -> matI (sbox (fAdd a k0), b)
            _ -> error $ "Poseidon2: malformed partial-round key at round " ++ show i

-- | The gnark 2-to-1 compression: permute (l, r) and feed the right input
-- forward into the second output element.
compress :: F -> F -> F
compress l r = let (_, b) = permutation (l, r) in fAdd b r

-- | Merkle–Damgård over 'compress' with a zero IV, matching gnark-crypto's
-- @NewMerkleDamgardHasher@. There is no length padding: callers must hash
-- fixed-shape inputs, as gnark circuits do.
hash :: [F] -> F
hash = foldl' compress (toF 0)
