{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE MagicHash #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
{-# OPTIONS_GHC -fno-warn-missing-fields #-}
import Control.Monad
import Criterion.Main
import qualified Data.ByteString        as B

import Blockchain.Data.Code
import Blockchain.VM.Code

import Test.Hspec

{-# NOINLINE exampleCode #-}
exampleCode :: Code
exampleCode = Code $ B.pack $ [0..255]


benchExtract1Slow :: Benchmark
benchExtract1Slow = bench "extract1 slow"
                  $ nf (defaultExtract exampleCode 128) 1

benchExtract1Fast :: Benchmark
benchExtract1Fast = bench "extract1 fast"
                  $ nf (fastExtractByte exampleCode) 128

benchExtract3Slow :: Benchmark
benchExtract3Slow = bench "extract3 slow"
                  $ nf (defaultExtract exampleCode 128) 3

benchExtract3Fast :: Benchmark
benchExtract3Fast = bench "extract3 fast"
                  $ nf (fastExtractSingle exampleCode 0) 3

benchExtract25Slow :: Benchmark
benchExtract25Slow = bench "extract25 slow"
                   $ nf (defaultExtract exampleCode 128) 25

benchExtract25Fast :: Benchmark
benchExtract25Fast = bench "extract25 fast"
                   $ nf (fastExtractQuad exampleCode 128) 25

spec :: Spec
spec = do
  describe "push1" $ do
    it "can extract 1 byte" $ do
       fastExtractByte exampleCode 0 `shouldBe` defaultExtract exampleCode 0 1
       fastExtractByte exampleCode 1 `shouldBe` defaultExtract exampleCode 1 1
       fastExtractByte exampleCode 2 `shouldBe` defaultExtract exampleCode 2 1
       map (fastExtractByte exampleCode) [0..255] `shouldBe` map (\x -> defaultExtract exampleCode x 1) [0..255]

  describe "push low" $ do
    it "can push 3 bytes" $ do
      forM_ [0, 1, 7, 128] $ \n ->
        fastExtractSingle exampleCode n 3 `shouldBe` defaultExtract exampleCode n 3
    it "can push 7 bytes" $ do
      forM_ [0, 1, 0xbb] $ \n ->
        fastExtractSingle exampleCode n 7 `shouldBe` defaultExtract exampleCode n 7

  describe "push high" $ do
    it "can push 25 bytes" $ do
      fastExtractQuad exampleCode 1 25 `shouldBe` defaultExtract exampleCode 1 25
    it "can push 31 bytes" $ do
      fastExtractQuad exampleCode 0 31 `shouldBe` defaultExtract exampleCode 0 31
      fastExtractQuad exampleCode 1 31 `shouldBe` defaultExtract exampleCode 1 31
      fastExtractQuad exampleCode 2 31 `shouldBe` defaultExtract exampleCode 2 31
    it "can push 32 bytes" $ do
      fastExtractQuad exampleCode 0 32 `shouldBe`  defaultExtract exampleCode 0 32
      fastExtractQuad exampleCode 1 32 `shouldBe`  defaultExtract exampleCode 1 32
      fastExtractQuad exampleCode 2 32 `shouldBe`  defaultExtract exampleCode 2 32
      fastExtractQuad exampleCode 64 32 `shouldBe` defaultExtract exampleCode 64 32


main :: IO ()
main = do
  hspec spec
  defaultMain [benchExtract1Slow, benchExtract1Fast,
               benchExtract3Slow, benchExtract3Fast,
               benchExtract25Slow, benchExtract25Fast]
