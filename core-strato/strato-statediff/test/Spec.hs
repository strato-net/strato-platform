import Blockchain.Strato.StateDiff.Kafka
import qualified Data.Text as T
import Test.Hspec

main :: IO ()
main = hspec spec

spec :: Spec
spec = do
  describe "StateDiff - Kafka" $ do
    it "can batch messages by size" $ do
      -- The binary encoding for text reserves two bytes for the
      -- start and end quotes
      let input = replicate 100 $ T.replicate 48 "z"
          got = mkMessages 200 input
      -- There should
      map length got `shouldBe` replicate 25 4

