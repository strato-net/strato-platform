{-# OPTIONS_GHC  -fno-warn-missing-signatures -fno-warn-type-defaults #-}

module Constants where

import Math.NumberTheory.Primes.Testing
import Data.List
import Data.Maybe

numBits = 512
wordBytes = 4
datasetBytesInit = 2^30
datasetBytesGrowth = 2^23
cacheBytesInit = 2^24
cacheBytesGrowth = 2^17
cacheMultiplier = 1024
epochLength = 30000
mixBytes = 128
hashBytes = 64
datasetParents = 256::Int
cacheRounds = 3::Int
accesses = 64


{-
def get_cache_size(block_number):
    sz = CACHE_BYTES_INIT + CACHE_BYTES_GROWTH * (block_number // EPOCH_LENGTH)
    sz -= HASH_BYTES
    while not isprime(sz / HASH_BYTES):
        sz -= 2 * HASH_BYTES
    return sz
-}

cacheSize::Integer->Integer
cacheSize blockNumber = 
    fromMaybe (error "Waaaaa?  There were no primes in call to cacheSize") $
    find (\t -> isPrime (t `div` hashBytes)) [(size - hashBytes),(size-3*hashBytes)..0]
  where
    size = cacheBytesInit + cacheBytesGrowth * (blockNumber `div` epochLength)
{-
def get_full_size(block_number):
    sz = DATASET_BYTES_INIT + DATASET_BYTES_GROWTH * (block_number // EPOCH_LENGTH)
    sz -= MIX_BYTES
    while not isprime(sz / MIX_BYTES):
        sz -= 2 * MIX_BYTES
    return sz
-}

fullSize::Integer->Integer
fullSize blockNumber = 
    fromMaybe (error "Waaaaa?  There were no primes in call to fullSize") $
    find (\t -> isPrime (t `div` mixBytes)) [(size - mixBytes),(size-3*mixBytes)..0]
  where
    size = datasetBytesInit + datasetBytesGrowth * (blockNumber `div` epochLength)
