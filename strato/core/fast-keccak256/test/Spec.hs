import Test.Hspec
import FastKeccak256
import qualified Data.ByteString as B

main :: IO ()
main = hspec spec

spec :: Spec
spec = do
  describe "fastKeccak256" $ do
    it "can execute" $ do
      fastKeccak256 B.empty `shouldBe` slowKeccak256 B.empty

