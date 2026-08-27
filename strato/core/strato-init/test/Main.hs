-- | Pins the RTS flag sizing to the expected-output matrix of
-- strato-net/private#94 (dynamic RTS flags by machine size).
module Main (main) where

import Blockchain.Init.RtsFlags
import Test.Hspec

main :: IO ()
main = hspec $ do
  describe "vmRunnerRtsFlags" $ do
    it "1 core, 4GB: serial, small nursery, capped heap" $
      vmRunnerRtsFlags 1 4096
        `shouldBe` words "-T -N1 -A16m -I2 -F1.5 -M2457m"
    it "2 cores, 8GB" $
      vmRunnerRtsFlags 2 8192
        `shouldBe` words "-T -N2 -A32m -n2m -qg1 -qn1 -I2 -F1.5 -M4915m"
    it "4 cores, 16GB" $
      vmRunnerRtsFlags 4 16384
        `shouldBe` words "-T -N4 -A64m -n4m -qg1 -qn2 -I2 -F1.5 -M9830m"
    it "4+ cores, >16GB: no heap cap" $
      vmRunnerRtsFlags 4 32768
        `shouldBe` words "-T -N4 -A128m -n4m -qg1 -qn2 -I2"
    it "caps -N at 4 on many-core machines (serial mutator)" $
      vmRunnerRtsFlags 16 65536
        `shouldBe` words "-T -N4 -A128m -n4m -qg1 -qn2 -I2"
    it "real-world 16GB box reporting less than nominal stays in its tier" $
      vmRunnerRtsFlags 4 15990
        `shouldBe` words "-T -N4 -A64m -n4m -qg1 -qn2 -I2 -F1.5 -M9594m"

  describe "sequencerRtsFlags" $ do
    it "1 core, 4GB" $
      sequencerRtsFlags 1 4096 `shouldBe` words "-T -N1 -A16m"
    it "2 cores, 8GB: single capability, so no -n chunking or -qg" $
      sequencerRtsFlags 2 8192 `shouldBe` words "-T -N1 -A32m"
    it "4 cores, 16GB" $
      sequencerRtsFlags 4 16384 `shouldBe` words "-T -N2 -A64m -n4m -qg1"
    it "4+ cores, >16GB" $
      sequencerRtsFlags 8 32768 `shouldBe` words "-T -N2 -A128m -n4m -qg1"

  describe "renderRtsFlags" $
    it "wraps flags in +RTS/-RTS" $
      renderRtsFlags (words "-T -N2") `shouldBe` "+RTS -T -N2 -RTS"

  describe "parseCgroupCpuMax" $ do
    it "limited: ceil(quota/period)" $
      parseCgroupCpuMax "150000 100000\n" `shouldBe` Just 2
    it "unlimited: 'max <period>'" $
      parseCgroupCpuMax "max 100000\n" `shouldBe` Nothing
    it "garbage" $
      parseCgroupCpuMax "" `shouldBe` Nothing

  describe "parseCgroupMemoryMax" $ do
    it "limited: bytes to MB" $
      parseCgroupMemoryMax "8589934592\n" `shouldBe` Just 8192
    it "unlimited: 'max'" $
      parseCgroupMemoryMax "max\n" `shouldBe` Nothing

  describe "parseMemInfoMB" $ do
    it "reads MemTotal in kB" $
      parseMemInfoMB "MemTotal:       16384000 kB\nMemFree:  123 kB\n"
        `shouldBe` Just 16000
    it "garbage" $
      parseMemInfoMB "no meminfo here" `shouldBe` Nothing
