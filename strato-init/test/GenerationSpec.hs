{-# LANGUAGE OverloadedStrings #-}
import Data.Aeson
import Data.Aeson.Diff
import qualified Data.ByteString as BS
import Test.Hspec

import Blockchain.Generation
import Blockchain.Strato.Model.Address

jsonShouldBe :: Value -> Value -> Expectation
jsonShouldBe l r = diff l r `shouldBe` Patch []

emptyContract :: BS.ByteString
emptyContract = "60606040525b600080fd00a165627a7a723058209b97b86115f9dfccb5f10ab93044730e948264e405825b26dccd1605775663710029"

sharedStart :: Address
sharedStart = Address 0x692a70d2e424a56d2c6c27aa97d1a86395877b3a

main :: IO ()
main = hspec $ do
  describe "hello world" $ do
    it "should do nothing" $ do
      let input = Null
      let want = input
      let got = insertContracts emptyContract sharedStart 0 input
      got `jsonShouldBe` want

