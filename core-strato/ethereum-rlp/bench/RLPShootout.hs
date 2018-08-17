import qualified Data.ByteString as BS

import Blockchain.Data.RLP

import Criterion.Main

benchSerialize_slow :: Int -> Benchmark
benchSerialize_slow n = bench ("List based serialization; size=" ++ show n)
                      . nf rlpSerialize_slow
                      . RLPString
                      $ BS.replicate n 0x49

benchSerialize :: Int -> Benchmark
benchSerialize n = bench ("Put based serialization; size=" ++ show n)
                 . nf rlpSerialize
                 . RLPString
                 $ BS.replicate n 0x22

main :: IO ()
main = defaultMain
     [ benchSerialize_slow 1024
     , benchSerialize_slow $ 1024 * 1024
     , benchSerialize_slow $ 10 * 1024 * 1024
     , benchSerialize 1024
     , benchSerialize $ 1024 * 1024
     , benchSerialize $ 10 * 1024 * 1024
     ]
