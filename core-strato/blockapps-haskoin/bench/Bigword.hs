{-# OPTIONS_GHC -fno-warn-orphans #-}
import Network.Haskoin.Crypto
import Control.DeepSeq
import Criterion.Main
import qualified Data.LargeWord as LW

instance (NFData a, NFData b) => NFData (LW.LargeKey a b) where
  rnf (LW.LargeKey a b) = rnf (a, b)


benchSumInt :: Int -> Benchmark
benchSumInt n = bench ("Summing integers; size=" ++ show n)
              . nf sum
              $ [0..n]

benchSumWord256 :: Int -> Benchmark
benchSumWord256 n = bench ("Summing word256; size=" ++ show n)
                  . nf sum
                  $ (map fromIntegral [1..n] :: [Word256])

benchProdInt :: Int -> Benchmark
benchProdInt n = bench ("Multiplying integers; size=" ++ show n)
               . nf product
               $ [0..n]

benchProdWord256 :: Int -> Benchmark
benchProdWord256 n = bench ("Multiplying word256; size=" ++ show n)
                   . nf product
                   $ (map fromIntegral [1..n] :: [Word256])

benchSumLargeWord :: Int -> Benchmark
benchSumLargeWord n = bench ("Summing LargeWord256; size=" ++ show n)
                    . nf sum
                    $ (map fromIntegral [1..n] :: [LW.Word256])

benchProdLargeWord :: Int -> Benchmark
benchProdLargeWord n = bench ("Multiplying LargeWord256; size=" ++ show n)
                     . nf product
                     $ (map fromIntegral [1..n] :: [LW.Word256])

main :: IO ()
main = let sizes =  [4096, 65536, 1048576, 16777216]
           msizes = [4096, 40960, 409600]
       in defaultMain $ map benchSumInt sizes ++ map benchSumWord256 sizes
                     ++ map benchSumLargeWord (take 2 sizes)
                     ++ map benchProdInt msizes ++ map benchProdWord256 msizes
                     ++ map benchProdLargeWord (take 1 msizes)
