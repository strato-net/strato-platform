module BlockApps.SoliditySpec where

import Test.Hspec
import Data.Aeson
import Data.Maybe
import qualified Data.ByteString.Lazy as ByteString
import BlockApps.Solidity.Xabi

spec :: Spec
spec = do
  describe "Xabi" $ do
    it "should decode correctly" $ do
      decodeXabi "test/BlockApps/Fixtures/example1.json"
      decodeXabi "test/BlockApps/Fixtures/example2.json"
      decodeXabi "test/BlockApps/Fixtures/example3.json"
      decodeXabi "test/BlockApps/Fixtures/example4.json"

decodeXabi :: FilePath -> Expectation
decodeXabi filePath = do
  exampleContract <- ByteString.readFile filePath
  let
    decoded :: Maybe Xabi
    decoded = decode exampleContract
  decoded `shouldSatisfy` isJust
