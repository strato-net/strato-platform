import qualified Data.ByteString as B
import FastKeccak256
import Test.Hspec

main :: IO ()
main = hspec spec

spec :: Spec
spec = do
  describe "fastKeccak256" $ do
    it "can execute" $ do
      fastKeccak256 B.empty `shouldBe` slowKeccak256 B.empty
