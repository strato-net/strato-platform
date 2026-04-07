#!/usr/bin/env node
// Generates Haskell constants file from circomlibjs poseidon_constants.js

const https = require('https');

const url = 'https://raw.githubusercontent.com/iden3/circomlibjs/main/src/poseidon_constants.js';

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    // Extract the JSON object from the JS module
    const match = data.match(/export default (\{[\s\S]*\});?\s*$/);
    if (!match) {
      console.error("Could not parse constants file");
      process.exit(1);
    }
    
    const constants = eval('(' + match[1] + ')');
    
    // Generate Haskell
    console.log(`{-# LANGUAGE OverloadedLists #-}
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

import Crypto.Hash.Poseidon.Field (F, fromHex)
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
roundConstants = V.fromList`);
    
    // Output C constants (just first 8 for T2-T9 which covers most use cases)
    console.log('  [');
    for (let t = 0; t < 8; t++) {
      const row = constants.C[t];
      const hexVals = row.map(h => `fromHex "${h}"`).join(', ');
      console.log(`    V.fromList [${hexVals}]${t < 7 ? ',' : ''}`);
    }
    console.log('  ]');
    
    console.log(`
-- | MDS matrices M, indexed by (t - 2)
mdsMatrix :: Vector (Vector (Vector F))
mdsMatrix = V.fromList`);
    
    // Output M matrices (just first 8)
    console.log('  [');
    for (let t = 0; t < 8; t++) {
      const mat = constants.M[t];
      console.log('    V.fromList');
      console.log('      [');
      for (let i = 0; i < mat.length; i++) {
        const row = mat[i].map(h => `fromHex "${h}"`).join(', ');
        console.log(`        V.fromList [${row}]${i < mat.length - 1 ? ',' : ''}`);
      }
      console.log(`      ]${t < 7 ? ',' : ''}`);
    }
    console.log('  ]');
  });
}).on('error', (e) => {
  console.error(e);
  process.exit(1);
});
