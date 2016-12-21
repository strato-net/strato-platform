{-# LANGUAGE TupleSections, FlexibleContexts #-}

module Dataset (
  Slice,
  calcDatasetItem
--  calcDataset
  ) where

import Control.Monad
import qualified Crypto.Hash.SHA3 as SHA3
import Constants
import qualified Data.Array.Base as A
import qualified Data.Array.IO as A
import Data.Bits
import Data.Word

import Cache
import Util

--import Debug.Trace

type Slice = A.IOUArray Word32 Word32

copySlice::Cache->Word32->IO Slice
copySlice cache i = do
  x <- A.newArray (0,15) 0
  forM_ [0..15] $ \k ->
    A.writeArray x k (cache A.! (i,k))
  return x

calcDatasetItem::Cache->Word32->IO Slice
calcDatasetItem cache i = do
  let n = getCacheWidth cache

  mix <- copySlice cache (i `mod` n)

  A.writeArray mix 0 =<< (fmap (xor i) $ A.readArray mix 0)

  mixBytes' <- sequence $ map (A.readArray mix) [0..15]
  let theHash = shatter $ SHA3.hash 512 $ repair mixBytes'
  sequence_ $ map (uncurry $ A.writeArray mix) $ zip [0..] theHash

  forM_ [0..fromIntegral $ datasetParents-1] $ \j ->
    cacheFunc cache i j mix

  mixBytes'' <- sequence $ map (A.readArray mix) [0..15]
  let theHash' = shatter $ SHA3.hash 512 $ repair mixBytes''
  sequence_ $ map (uncurry $ A.writeArray mix) $ zip [0..] theHash'

  return mix



cacheFunc::Cache->Word32->Word32->Slice->IO ()
cacheFunc cache i j mix = do
 let r = fromInteger $ hashBytes `div` wordBytes
     n = getCacheWidth cache

 cacheIndex <- fmap (fnv (i `xor` j)) $ A.unsafeRead mix $ fromIntegral $ j `mod` r

 let baseOffset = fromIntegral $ 16 * (cacheIndex `mod` n)

     modword k = do
       v1 <- A.unsafeRead mix k
       let v2 = cache `A.unsafeAt` (baseOffset + k)
       A.unsafeWrite mix k $ fnv v1 v2

 modword 0 --copied by hand for performance reasons
 modword 1
 modword 2
 modword 3
 modword 4
 modword 5
 modword 6
 modword 7
 modword 8
 modword 9
 modword 10
 modword 11
 modword 12
 modword 13
 modword 14
 modword 15

{-
calcDataset::Word32->Cache->Cache
calcDataset size cache =
  A.listArray ((0,0), ((size-1) `div` fromInteger hashBytes, 16))
  $ concatMap (A.elems . calcDatasetItem cache)
  [0..]
-}
