{-# LANGUAGE RecordWildCards #-}
module Slipstream.DelayedBloomFilter
  ( DelayedBloomFilter
  , newFilter
  , insert
  , elem
  , length
  ) where

import qualified Data.BloomFilter as BL
import qualified Data.BloomFilter.Hash as BL
import qualified Data.BloomFilter.Easy as BL
import Prelude hiding (length, elem)

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
  , bloom :: !(BL.Bloom a)
  }

newFilter :: BL.Hashable a => Int -> DelayedBloomFilter a
newFilter n = let (numBits, numHashes) = BL.suggestSizing 1000000 0.05
                  bloom = BL.empty (BL.cheapHashes numHashes) numBits
              in DBF 0 n [] bloom

insert :: a -> DelayedBloomFilter a -> DelayedBloomFilter a
insert x dbf@DBF{..} =
  if stackDepth >= maxStack
    then dbf{ stackDepth = 0
            , stack = []
            , bloom = BL.insertList (x:stack) bloom
            }
    else dbf{ stackDepth = stackDepth + 1
            , stack = x:stack
            }

elem :: a -> DelayedBloomFilter a -> Bool
elem x = BL.elem x . bloom

length :: DelayedBloomFilter a -> Int
length = BL.length . bloom
