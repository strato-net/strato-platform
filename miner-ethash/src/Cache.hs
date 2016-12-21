{-# LANGUAGE TupleSections #-}

module Cache (
  Cache,
  mkCache,
  getCacheWidth
  ) where

import Control.Monad
import qualified Crypto.Hash.SHA3 as SHA3
import Constants
import qualified Data.Array.Unboxed as A
import qualified Data.Array.IO as MA
import qualified Data.Array.IO.Internals as MA
import qualified Data.ByteString as B
import Data.Word

import Util

type Cache = A.UArray (Word32, Word32) Word32

mkCache :: Integer -> B.ByteString -> IO Cache
mkCache cSize seed = do
  let n = cSize `div` hashBytes
      v = initDataSet n $ SHA3.hash 512 seed
  mv <- MA.unsafeThawIOUArray v
  mix mv
  return v

{-
for _ in range(CACHE_ROUNDS):
        for i in range(n):
            v = o[i][0] % n
            o[i] = sha3_512(map(xor, o[(i-1+n) % n], o[v]))

-}

getIOUArrayWidth::MA.IOUArray (Word32, Word32) Word32->IO Word32
getIOUArrayWidth mx = do
  ((0, _), (n, _)) <- MA.getBounds mx
  return $ n + 1
  
getCacheWidth::Cache->Word32
getCacheWidth array =
  let ((0, _), (n, _)) = A.bounds array
  in n + 1
  

mix::MA.IOUArray (Word32, Word32) Word32->IO ()
mix mx = do
  n <- getIOUArrayWidth mx

  replicateM_ cacheRounds $
    forM_ [0..(n-1)] $ \i -> do
      idex <-  MA.readArray mx (i, 0)

      let v = fromIntegral idex `mod` n
      
      m1 <- fmap repair $ sequence $ map (MA.readArray mx . (v,)) $ [0..15]
      m2 <- fmap repair $ sequence $ map (MA.readArray mx . ((i-1+n) `mod` n,)) [0..15]
      sequence $
        map (\(k, val) -> MA.writeArray mx (i,k) val) $
        zip [0..15] $ shatter $ SHA3.hash 512 $ xorBS m1 m2

initDataSet::Integer->B.ByteString->Cache
initDataSet n | n > toInteger (maxBound::Word32) =
  error "initDataSet called for value too large, you can no longer use Word32 for cache index"
initDataSet n = A.listArray ((0,0), (fromIntegral n-1,15)) . concat . map shatter . iterate (SHA3.hash 512)
              
