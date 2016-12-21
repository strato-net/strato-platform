{-# LANGUAGE FlexibleContexts #-}

module Hashimoto where

import Control.Monad
import Constants
import qualified Crypto.Hash.SHA3 as SHA3
import qualified Data.Array.IO as MA
import Data.Binary.Get
import Data.Binary.Put
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Word

import Dataset
import Util

--import Debug.Trace

-- type Dataset =  Repa.Array BN.Word32 Repa.DIM1 Int



{- def hashimoto(header, nonce, full_size, dataset_lookup):
    n = full_size / HASH_BYTES
    mixhashes = MIX_BYTES / HASH_BYTES
    # combine header+nonce into a 64 byte seed
    s = sha3_512(header + nonce[::-1])
    # start the mix with replicated s
    mix = []
    for _ in range(MIX_BYTES / HASH_BYTES):
        mix.extend(s)
    # mix in random dataset nodes
    for i in range(ACCESSES):
        p = fnv(i ^ s[0], mix[i % w]) % (n // mixhashes) * mixhashes
        newdata = []
        for j in range(MIX_BYTES / HASH_BYTES):
            newdata.extend(dataset_lookup(p + j))
        mix = map(fnv, mix, newdata)
    # compress mix
    cmix = []
    for i in range(0, len(mix), 4):
        cmix.append(fnv(fnv(fnv(mix[i], mix[i+1]), mix[i+2]), mix[i+3]))
    return {
        "mix digest": serialize_hash(cmix),
        "result": serialize_hash(sha3_256(s+cmix))
    }
-}

wordPack::[Word32]->B.ByteString
wordPack = B.concat . fmap (BL.toStrict . runPut . putWord32le) 

hashimoto::B.ByteString->B.ByteString->Int->(Word32->IO Slice)->IO (B.ByteString, B.ByteString)
hashimoto header nonce fullSize' dataset = do
  let mixhashes = mixBytes `div` hashBytes
      s = SHA3.hash 512 $ header `B.append` B.reverse nonce

  mix <- MA.newArray (0,31) 0

  sequence_ $ map (uncurry $ MA.writeArray mix) $ zip [0..] (shatter s)
  sequence_ $ map (uncurry $ MA.writeArray mix) $ zip [16..] (shatter s)

  forM_ [0..63] $ \j ->
    f (dataset, fullSize', mixhashes, s) j mix


  let f2 i = do
        v1 <- MA.readArray mix i
        v2 <- MA.readArray mix $ i + 1
        v3 <- MA.readArray mix $ i + 2
        v4 <- MA.readArray mix $ i + 3
        return $ v1 `fnv` v2 `fnv`  v3 `fnv` v4

  cmix <- fmap repair $ sequence $ map f2 [0,4..31]
  return (cmix, SHA3.hash 256 (s `B.append` cmix))
  

f::(Word32->IO Slice, Int, Integer, B.ByteString)->Word32->MA.IOUArray Word32 Word32->IO ()
f (dataset, fullSize', mixhashes, s) i mix = do
  let n = fullSize' `div` fromInteger hashBytes
      w = mixBytes `div` wordBytes

  mixVal <- MA.readArray mix (i `mod` fromInteger w)
  
  let p = (fnv (i `xor` (runGet getWord32le $ BL.fromStrict $ B.take 4 s))
           mixVal) `mod` (fromIntegral n `div` fromInteger mixhashes) * fromInteger mixhashes
  data1 <- dataset p
  data2 <- dataset $ p + 1
  
  forM_ [0..15] $ \k -> do
    v1 <- MA.readArray mix k
    v2 <- MA.readArray data1 k
    MA.writeArray mix k (fnv v1 v2)

  forM_ [0..15] $ \k -> do
    v1 <- MA.readArray mix $ k + 16
    v2 <- MA.readArray data2 k
    MA.writeArray mix (k+16) (fnv v1 v2)

  where






--hashimotoFull :: Int -> Dataset -> SHA -> Int
--hashimotoFull fullSize dataset header nonce = undefined

-- mixHash ::  -> SHA
