module VotingSpec where

import           Test.Hspec

spec :: Spec
spec = pure ()
{-
import Data.Map
import Test.Hspec

import Blockchain.Blockstanbul.Voting
import Blockchain.Strato.Model.Address

testUpdate :: [Address]
testUpdate     = fst3 $  updateValidator [Address 0x23451,Address 0x43123,Address 0x323] (fromList[(Address 0x23450,fromList[(Address 0x43123,True),(Address 0x323,True),(Address 0x23451,True)])])

testUpdatedrop :: [Address]
testUpdatedrop = fst3 $  updateValidator [Address 0x23451, Address 0x23450, Address 0x43123,Address 0x323] (fromList[(Address 0x23450,fromList[(Address 0x43123,False),(Address 0x323,False),(Address 0x23451,False)])])

testUpdatesize2 ::[Address]
testUpdatesize2 = fst3 $ updateValidator [Address 0x43123,Address 0x323] (fromList[(Address 0x23450,fromList[(Address 0x43123,True),(Address 0x323,True)])])

testUpdatesize1 ::[Address]
testUpdatesize1 = fst3 $ updateValidator [Address 0x43123] (fromList[(Address 0x23450,fromList[(Address 0x43123,True)])])

testUpdateTwice :: [Address]
testUpdateTwice = fst3 $ updateValidator testUpdate (fromList[(Address 0x23450,fromList[(Address 0x43123,True),(Address 0x323,True),(Address 0x23451,True),(Address 0x23450,True)])])

testDropVoid :: [Address]
testDropVoid =  fst3 $  updateValidator [Address 0x23451, Address 0x23452, Address 0x43123,Address 0x323] (fromList[(Address 0x23450,fromList[(Address 0x43123,False),(Address 0x323,False),(Address 0x23451,False),(Address 0x23452,False)])])

fst3 :: (a, b, c) -> a
fst3 (x, _, _) = x

spec :: Spec
spec = parallel $ do
  describe "test updateValidator" $ do
    it "update new list of validator" $ do
      testUpdate `shouldBe` [Address 0x323, Address 0x23450, Address 0x23451, Address 0x43123]
      testUpdateTwice `shouldBe` [Address 0x323, Address 0x23450, Address 0x23451,Address 0x43123]
      testDropVoid `shouldBe` [Address 0x323, Address 0x23451,Address 0x23452, Address 0x43123]
      testUpdatedrop `shouldBe` [Address 0x323, Address 0x23451,Address 0x43123]
      testUpdatesize1 `shouldBe` [Address 0x23450,Address 0x43123]
      testUpdatesize2 `shouldBe` [Address 0x323,Address 0x23450,Address 0x43123]

    it "Needs three votes from 4 validators" $ do
      let validators = [1..4]
          votes = singleton 0xff . fromList . zip [1, 3, 4] $ repeat True
      (fst3 $  updateValidator validators votes) `shouldBe` [1,2,3,4,0xff]
-}
