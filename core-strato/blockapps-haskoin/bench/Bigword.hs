{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# OPTIONS_GHC -fno-warn-unused-binds #-}
import Network.Haskoin.Crypto
import Numeric
import Control.DeepSeq
import Criterion.Main
import qualified Data.LargeWord as LW
import qualified Data.DoubleWord as DW

instance (NFData a, NFData b) => NFData (LW.LargeKey a b) where
  rnf (LW.LargeKey a b) = rnf (a, b)

instance NFData DW.Word256 where
  rnf (DW.Word256 a b) = a `seq` b `seq` ()


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

benchShowHexInt :: Int -> Benchmark
benchShowHexInt n = bench ("Rendering hex Integer; size=" ++ show n)
                  . nf (map $ flip showHex "")
                  $ [0..n]

benchShowHexWord256 :: Int -> Benchmark
benchShowHexWord256 n = bench ("Rendering hex Word256; size=" ++ show n)
                  . nf (map $ flip showHex "")
                  $ (map fromIntegral [0..n] :: [Word256])

benchShowHexLargeWord :: Int -> Benchmark
benchShowHexLargeWord n = bench ("Rendering hex LargeWord; size=" ++ show n)
                        . nf (map $ flip showHex "" . toInteger)
                        $ (map fromIntegral [0..n] :: [LW.Word256])

benchSumDouble :: Int -> Benchmark
benchSumDouble n = bench ("Summing DoubleWord256; size=" ++ show n)
                    . nf sum
                    $ (map fromIntegral [1..n] :: [DW.Word256])

benchProdDouble :: Int -> Benchmark
benchProdDouble n = bench ("Multiplying DoubleWord256; size=" ++ show n)
                     . nf product
                     $ (map fromIntegral [1..n] :: [DW.Word256])

benchShowHexDouble :: Int -> Benchmark
benchShowHexDouble n = bench ("Rendering hex DoubleWord256; size=" ++ show n)
                  . nf (map $ flip showHex "")
                  $ (map fromIntegral [1..n] :: [DW.Word256])

main :: IO ()
main = let sizes =  [1, 10, 100, 4096, 65536, 1048576]
           msizes = [4096, 40960, 409600]
       in defaultMain $ []
                     ++ map benchSumInt (drop 3 sizes)
                     ++ map benchSumWord256 (drop 3 sizes)
                     ++ map benchSumDouble (drop 3 sizes)
                     ++ map benchSumLargeWord (take 3 $ drop 2 sizes)
                     ++ map benchProdInt msizes
                     ++ map benchProdWord256 msizes
                     ++ map benchProdDouble msizes
                     ++ map benchProdLargeWord (take 1 msizes)
                     ++ map benchShowHexInt sizes
                     ++ map benchShowHexWord256 sizes
                     ++ map benchShowHexDouble sizes
                     ++ map benchShowHexLargeWord (take 3 sizes)
