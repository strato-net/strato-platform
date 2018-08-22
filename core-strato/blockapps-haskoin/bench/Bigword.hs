import Network.Haskoin.Crypto
import Criterion.Main

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


main :: IO ()
main = let sizes = [4096, 65536, 1048576, 16777216]
           msizes = [4096, 40960, 409600]
       in defaultMain $ map benchSumInt sizes ++ map benchSumWord256 sizes
                     ++ map benchProdInt msizes ++ map benchProdWord256 msizes
