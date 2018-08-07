module VotingSpec where

import Test.Hspec
import Data.Map
import Blockchain.Data.Address
import Blockchain.Blockstanbul.Voting

testUpdate :: [Address]
testUpdate = updateValidator [Address 0x23451,Address 0x43123,Address 0x323] (fromList[(Address 0x23450,fromList[(Address 0x43123,True),(Address 0x323,True),(Address 0x23451,True)])])

testUpdatedrop :: [Address]
testUpdatedrop = updateValidator [Address 0x23451, Address 0x23450, Address 0x43123,Address 0x323] (fromList[(Address 0x23450,fromList[(Address 0x43123,False),(Address 0x323,False),(Address 0x23451,False)])])

testUpdatesize2 ::[Address]
testUpdatesize2 = updateValidator [Address 0x43123,Address 0x323] (fromList[(Address 0x23450,fromList[(Address 0x43123,True),(Address 0x323,True)])])

testUpdatesize1 ::[Address]
testUpdatesize1 = updateValidator [Address 0x43123] (fromList[(Address 0x23450,fromList[(Address 0x43123,True)])])

spec :: Spec
spec = parallel $ do
  describe "test updateValidator" $ do
    it "update new list of validator" $ do
      testUpdate `shouldBe` [Address 0x23451,Address 0x43123,Address 0x323,Address 0x23450]
      testUpdatedrop `shouldBe` [Address 0x23451,Address 0x43123,Address 0x323]
      testUpdatesize1 `shouldBe` [Address 0x43123, Address 0x23450]
      testUpdatesize2 `shouldBe` [Address 0x43123,Address 0x323,Address 0x23450]
