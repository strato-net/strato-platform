{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Slipstream.DelayedBloomFilter
  ( DelayedBloomFilter
  , newFilter
  , insert
  , elem
  , bitWidth
  , stackDepth
  ) where

import qualified Data.BloomFilter as BF
import qualified Data.BloomFilter.Hash as BF
import qualified Data.BloomFilter.Easy as BF
import Prelude hiding (elem)

import BlockApps.Ethereum

instance BF.Hashable ChainId where
  hashIO32 (ChainId n) = BF.hashIO32 (toInteger n)
  hashIO64 (ChainId n) = BF.hashIO64 (toInteger n)

instance BF.Hashable Address where
  hashIO32 (Address n) = BF.hashIO32 (toInteger n)
  hashIO64 (Address n) = BF.hashIO64 (toInteger n)

-- A Delayed Bloom Filter is a combination of a stack with a traditional
-- bloom filter. The stack is used to buffer pending changes to the bloom filter for
-- two reasons:
-- 1. Writes will typically alternate with reads as slipstream compares the new
--    state to the historical one, which means that the `insert`s to
--    the bloom filter cannot be fused and each write would result in a full
--    copy. Inserting the keys as list inside of a the ST monad amortizes that cost.
-- 2. Until the cache is filled, every follow up query to the database will miss.
--    By delaying the population of the filter, it will return "does not exist"
--    for everything until the stack is flushed. After each flush the likelihood
--    of a false positive from the bloom filter increases, but the only cost
--    is a database read of a nonexistent row.
--
-- The size of the filter is tuned for 1,000,000 elements at a 5% false positive rate.

data DelayedBloomFilter a = DBF
  { stackDepth :: !Int
  , maxStack :: !Int
  , stack :: ![a]
  , bloom :: !(BF.Bloom a)
  }

newFilter :: BF.Hashable a => Int -> DelayedBloomFilter a
newFilter n = let (numBits, numHashes) = BF.suggestSizing 1000000 0.05
                  bloom = BF.empty (BF.cheapHashes numHashes) numBits
              in DBF 0 n [] bloom

insert :: a -> DelayedBloomFilter a -> DelayedBloomFilter a
insert x dbf@DBF{..} =
  if stackDepth >= maxStack
    then dbf{ stackDepth = 0
            , stack = []
            , bloom = BF.insertList (x:stack) bloom
            }
    else dbf{ stackDepth = stackDepth + 1
            , stack = x:stack
            }

elem :: a -> DelayedBloomFilter a -> Bool
elem x = BF.elem x . bloom

bitWidth :: DelayedBloomFilter a -> Int
bitWidth = BF.length . bloom
