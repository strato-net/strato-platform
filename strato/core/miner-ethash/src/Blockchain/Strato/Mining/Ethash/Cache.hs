{-# LANGUAGE TupleSections #-}

module Blockchain.Strato.Mining.Ethash.Cache
  ( Cache,
    mkCache,
    getCacheWidth,
  )
where

import Blockchain.Strato.Mining.Ethash.Constants
import Blockchain.Strato.Mining.Ethash.Util
import Blockchain.Strato.Model.Keccak512 (keccak512)
import Control.Monad
import qualified Data.Array.IO as MA
import qualified Data.Array.IO.Internals as MA
import qualified Data.Array.Unboxed as A
import qualified Data.ByteString as B
import Data.Word

type Cache = A.UArray (Word32, Word32) Word32

mkCache :: Integer -> B.ByteString -> IO Cache
mkCache cSize seed = do
  let n = cSize `div` hashBytes
      v = initDataSet n $ keccak512 seed
  mv <- MA.unsafeThawIOUArray v
  mix mv
  return v

{-
for _ in range(CACHE_ROUNDS):
        for i in range(n):
            v = o[i][0] % n
            o[i] = keccak512(map(xor, o[(i-1+n) % n], o[v]))

-}

getIOUArrayWidth :: MA.IOUArray (Word32, Word32) Word32 -> IO Word32
getIOUArrayWidth mx = do
  ((0, _), (n, _)) <- MA.getBounds mx
  return $ n + 1

getCacheWidth :: Cache -> Word32
getCacheWidth array =
  case A.bounds array of
    ((0, _), (n, _)) -> n + 1
    _ -> error "getCacheWidth: impossible"

mix :: MA.IOUArray (Word32, Word32) Word32 -> IO ()
mix mx = do
  n <- getIOUArrayWidth mx

  replicateM_ cacheRounds $
    forM_ [0 .. (n - 1)] $ \i -> do
      idex <- MA.readArray mx (i, 0)

      let v = fromIntegral idex `mod` n

      m1 <- fmap repair $ sequence $ map (MA.readArray mx . (v,)) $ [0 .. 15]
      m2 <- fmap repair $ sequence $ map (MA.readArray mx . ((i - 1 + n) `mod` n,)) [0 .. 15]
      sequence $
        map (\(k, val) -> MA.writeArray mx (i, k) val) $
          zip [0 .. 15] $ shatter $ keccak512 $ xorBS m1 m2

initDataSet :: Integer -> B.ByteString -> Cache
initDataSet n
  | n > toInteger (maxBound :: Word32) =
    error "initDataSet called for value too large, you can no longer use Word32 for cache index"
initDataSet n = A.listArray ((0, 0), (fromIntegral n - 1, 15)) . concat . map shatter . iterate keccak512
