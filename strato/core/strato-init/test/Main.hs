-- | Pins the RTS flag sizing to the acceptance table of the 2026-08-28 A/B
-- benchmark round (strato-net/private#94 follow-up; data in
-- vm-runner/replay/results/2026-08-28-rts-flag-ab.md): pool-first nursery
-- sizing, no GC trimmings (-n/-qg1/-qn measured as no-ops).
module Main (main) where

import Blockchain.Init.RtsFlags
import Test.Hspec

main :: IO ()
main = hspec $ do
  describe "vmRunnerRtsFlags" $ do
    it "4+ cores, >16GB: full 512MB pool across 4 capabilities, no heap cap" $
      vmRunnerRtsFlags 4 32768 `shouldBe` words "-T -N4 -A128m -I2"
    it "caps -N at 4 on many-core machines (serial mutator)" $
      vmRunnerRtsFlags 16 65536 `shouldBe` words "-T -N4 -A128m -I2"
    it "4 cores, 16GB nominal" $
      vmRunnerRtsFlags 4 16384
        `shouldBe` words "-T -N4 -A64m -I2 -F1.5 -M9830m"
    it "4 cores, real-world 16GB box reporting less than nominal" $
      vmRunnerRtsFlags 4 15975
        `shouldBe` words "-T -N4 -A64m -I2 -F1.5 -M9585m"
    it "2 cores, real-world 8GB: one capability owns the whole 128MB pool" $
      vmRunnerRtsFlags 2 7987
        `shouldBe` words "-T -N1 -A128m -I2 -F1.5 -M4792m"
    it "cgroup-limited container: 2 CPUs, 8GB memory.max" $
      vmRunnerRtsFlags 2 8192
        `shouldBe` words "-T -N1 -A128m -I2 -F1.5 -M4915m"
    it "3 cores, 8GB" $
      vmRunnerRtsFlags 3 8192
        `shouldBe` words "-T -N2 -A64m -I2 -F1.5 -M4915m"
    it "4 cores, 8GB: least-validated cell (32MB per-cap nursery)" $
      vmRunnerRtsFlags 4 8192
        `shouldBe` words "-T -N4 -A32m -I2 -F1.5 -M4915m"
    it "1 core, 4GB: snapshot-only tier" $
      vmRunnerRtsFlags 1 4096
        `shouldBe` words "-T -N1 -A64m -I2 -F1.5 -M2457m"

  describe "sequencerRtsFlags" $ do
    it "4+ cores, >16GB" $
      sequencerRtsFlags 8 32768 `shouldBe` words "-T -N2 -A128m -I2"
    it "4 cores, 16GB (nominal and real-world)" $ do
      sequencerRtsFlags 4 16384 `shouldBe` words "-T -N2 -A64m -I2"
      sequencerRtsFlags 4 15975 `shouldBe` words "-T -N2 -A64m -I2"
    it "2 cores, real-world 8GB" $
      sequencerRtsFlags 2 7987 `shouldBe` words "-T -N1 -A64m -I2"
    it "3 cores, 8GB: single capability below 4 cores" $
      sequencerRtsFlags 3 8192 `shouldBe` words "-T -N1 -A64m -I2"
    it "1 core, 4GB" $
      sequencerRtsFlags 1 4096 `shouldBe` words "-T -N1 -A32m -I2"

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
