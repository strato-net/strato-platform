import qualified Data.ByteString as BS

import Blockchain.Data.RLP

import Criterion.Main

benchSerialize_slow :: Int -> Benchmark
benchSerialize_slow n = bench ("List based string serialization; size=" ++ show n)
                      . nf rlpSerialize_slow
                      . RLPString
                      $ BS.replicate n 0x49

benchSerialize :: Int -> Benchmark
benchSerialize n = bench ("Put based string serialization; size=" ++ show n)
                 . nf rlpSerialize
                 . RLPString
                 $ BS.replicate n 0x22

benchObjSerialize_slow :: Int -> Benchmark
benchObjSerialize_slow n = bench ("List based array serialization; size=1024x" ++ show n)
                         . nf rlpSerialize_slow
                         . RLPArray
                         . replicate n
                         . RLPString
                         $ BS.replicate 1024 0x88

benchObjSerialize :: Int -> Benchmark
benchObjSerialize n = bench ("Put based array serialization; size=1024x" ++ show n)
                    . nf rlpSerialize
                    . RLPArray
                    . replicate n
                    . RLPString
                    $ BS.replicate 1024 0x88

benchDeserialize :: Int -> Benchmark
benchDeserialize n = bench ("List based deserialization; size=" ++ show n)
                      . nf rlpDeserialize
                      . rlpSerialize
                      . RLPString
                      $ BS.replicate n 0x49

main :: IO ()
main = let sizes = [1024, 1024 * 1024, 10 * 1024 * 1024]
           objSizes = [1024, 10 * 1024]
           tests = map benchSerialize_slow sizes
                ++ map benchSerialize sizes
                ++ map benchDeserialize sizes
                ++ map benchObjSerialize_slow objSizes
                ++ map benchObjSerialize objSizes
       in defaultMain tests
