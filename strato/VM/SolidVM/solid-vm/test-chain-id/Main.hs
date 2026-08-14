module Main (main) where

import Blockchain.EthConf (ethConf)
import Blockchain.EthConf.Model (chainId, networkConfig)
import Blockchain.SolidVM (solidVMChainId)
import Test.Hspec

main :: IO ()
main = hspec $
  describe "SolidVM block.chainid" $
    it "uses the configured EIP-155 chain ID" $
      solidVMChainId `shouldBe` chainId (networkConfig ethConf)
