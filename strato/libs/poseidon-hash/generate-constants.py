#!/usr/bin/env python3
"""Generate Haskell constants file from circomlibjs poseidon_constants.js"""

import urllib.request
import re
import json

url = 'https://raw.githubusercontent.com/iden3/circomlibjs/main/src/poseidon_constants.js'

with urllib.request.urlopen(url) as response:
    data = response.read().decode('utf-8')

# Extract JSON from JS module export
match = re.search(r'export default (\{[\s\S]*\});?\s*$', data)
if not match:
    raise ValueError("Could not parse constants file")

constants = json.loads(match.group(1))

print("""{-# LANGUAGE OverloadedLists #-}
-- | 
-- Module      : Crypto.Hash.Poseidon.Constants
-- Description : Pre-computed round constants and MDS matrices for Poseidon
--
-- AUTO-GENERATED from circomlibjs poseidon_constants.js
-- Do not edit manually.

module Crypto.Hash.Poseidon.Constants
  ( roundConstants
  , mdsMatrix
  , nRoundsF
  , nRoundsP
  ) where

import Crypto.Hash.Poseidon.Field (F, toF)
import Data.Vector (Vector)
import qualified Data.Vector as V

-- | Number of full rounds (constant for all input sizes)
nRoundsF :: Int
nRoundsF = 8

-- | Number of partial rounds indexed by (t - 2) where t = inputs + 1
nRoundsP :: Vector Int
nRoundsP = V.fromList [56, 57, 56, 60, 60, 63, 64, 63, 60, 66, 60, 65, 70, 60, 64, 68]

-- | Round constants C, indexed by (t - 2)
roundConstants :: Vector (Vector F)
roundConstants = V.fromList""")

# Output C constants (first 8 for T2-T9) as Integer literals
print('  [')
for t in range(8):
    row = constants['C'][t]
    # Convert hex to decimal integers
    int_vals = ', '.join(f'toF {int(h, 16)}' for h in row)
    comma = ',' if t < 7 else ''
    print(f'    V.fromList [{int_vals}]{comma}')
print('  ]')

print("""
-- | MDS matrices M, indexed by (t - 2)
mdsMatrix :: Vector (Vector (Vector F))
mdsMatrix = V.fromList""")

# Output M matrices (first 8) as Integer literals
print('  [')
for t in range(8):
    mat = constants['M'][t]
    print('    V.fromList')
    print('      [')
    for i, row in enumerate(mat):
        int_vals = ', '.join(f'toF {int(h, 16)}' for h in row)
        comma = ',' if i < len(mat) - 1 else ''
        print(f'        V.fromList [{int_vals}]{comma}')
    comma = ',' if t < 7 else ''
    print(f'      ]{comma}')
print('  ]')
