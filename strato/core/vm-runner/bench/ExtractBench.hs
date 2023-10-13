import Blockchain.EVM.Opcodes
import Criterion.Main
import qualified Data.ByteString as B

{-# NOINLINE exampleCode #-}
exampleCode :: B.ByteString
exampleCode = B.pack $ [0 .. 255]

benchExtract1Slow :: Benchmark
benchExtract1Slow =
  bench "extract1 slow" $
    nf (defaultExtract exampleCode 128) 1

benchExtract1Fast :: Benchmark
benchExtract1Fast =
  bench "extract1 fast" $
    nf (fastExtractByte exampleCode) 128

benchExtract3Slow :: Benchmark
benchExtract3Slow =
  bench "extract3 slow" $
    nf (defaultExtract exampleCode 128) 3

benchExtract3Fast :: Benchmark
benchExtract3Fast =
  bench "extract3 fast" $
    nf (fastExtractSingle exampleCode 0) 3

benchExtract25Slow :: Benchmark
benchExtract25Slow =
  bench "extract25 slow" $
    nf (defaultExtract exampleCode 128) 25

benchExtract25Fast :: Benchmark
benchExtract25Fast =
  bench "extract25 fast" $
    nf (fastExtractQuad exampleCode 128) 25

main :: IO ()
main = do
  defaultMain
    [ benchExtract1Slow,
      benchExtract1Fast,
      benchExtract3Slow,
      benchExtract3Fast,
      benchExtract25Slow,
      benchExtract25Fast
    ]
