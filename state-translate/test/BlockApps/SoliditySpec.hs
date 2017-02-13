module BlockApps.SoliditySpec where

import Test.Hspec

spec :: Spec
spec = do
  describe "decodeValue" $ do
    it "should decode uint32 correctly" $ do
      let
        storage = fst $ Base16.decode
          "0000000000000000000000000000000000000000000000000000000000000045"
      decodeValue storage 0 (TypeUInt (Just 32)) `shouldBe` ValueUInt 69
    it "should decode uint32 correctly" $ do
      let
        storage = fst $ Base16.decode
          "1000000000000000000000000000000000000000000000000000000000000000"
      decodeValue storage 0 (TypeUInt (Just 32)) `shouldBe` ValueUInt (2^255)
    it "should decode int32 correctly" $ do
      let
        storage = fst $ Base16.decode
          "0000000000000000000000000000000000000000000000000000000000000045"
      decodeValue storage 0 (TypeInt (Just 32)) `shouldBe` ValueInt 69
    it "should decode Address correctly" $ do
      let
        storage = fst $ Base16.decode
          "000000000000000000000000abcdabcdabcdabcdabcdabcdabcdabcdabcdabcd"
        address = Address 0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd
