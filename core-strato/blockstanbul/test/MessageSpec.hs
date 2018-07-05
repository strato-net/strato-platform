module MessageSpec where

import Test.Hspec

import Blockchain.Blockstanbul.Messages
import Blockchain.SHA

spec :: Spec
spec = parallel $ do
  describe "Authentication" $ do
    it "doesn't get the right hash" $ do
      let msg = Prepare undefined undefined (SHA 4)
      getHash msg `shouldBe` SHA 4
