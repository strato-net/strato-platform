{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
import qualified Data.ByteString as BS
import qualified Data.ByteString.Random as BR

import Control.Monad (replicateM)

import Blockchain.Data.RLP

import Criterion.Main

benchSerialize_slow :: BS.ByteString -> Benchmark
benchSerialize_slow str = bench ("List based string serialization; size=" ++ show (BS.length str))
                      . nf rlpSerialize_slow
                      . RLPString
                      $ str

benchSerialize :: BS.ByteString-> Benchmark
benchSerialize str = bench ("Put based string serialization; size=" ++ show (BS.length str))
                   . nf rlpSerialize
                   . RLPString
                   $ str

benchObjSerialize_slow :: [BS.ByteString] -> Benchmark
benchObjSerialize_slow arr = bench ("List based array serialization; size=1024x" ++ show (BS.length (head arr)))
                         . nf rlpSerialize_slow
                         . RLPArray
                         . map RLPString
                         $ arr

benchObjSerialize :: [BS.ByteString] -> Benchmark
benchObjSerialize arr = bench ("Put based array serialization; size=1024x" ++ show (BS.length (head arr)))
                    . nf rlpSerialize
                    . RLPArray
                    . map RLPString
                    $ arr

main :: IO ()
main = do
  strings <- mapM BR.random [1024, 1024 * 1024, 10 * 1024 * 1024]
  arrays <- mapM (replicateM 1024 . BR.random) [1, 1024, 10 * 1024]
  let tests = map benchSerialize strings
           ++ map benchSerialize_slow strings
           ++ map benchObjSerialize arrays
           ++ map benchObjSerialize_slow arrays
  defaultMain tests
