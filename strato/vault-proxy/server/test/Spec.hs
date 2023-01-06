import Test.Hspec

main :: IO ()
main = hspec $ do
  describe "Testing is not created yet for vault-proxy" $ do
    it "returns the first element of a list" $ do
      head [23 ..] `shouldBe` (23 :: Int)