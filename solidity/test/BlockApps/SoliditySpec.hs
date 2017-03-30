module BlockApps.SoliditySpec where

import Test.Hspec
import Data.Aeson
import Data.Either
import qualified Data.ByteString.Lazy as ByteString
import BlockApps.Solidity.Xabi

spec :: Spec
spec = do
  describe "Xabi" $ do
    it "should decode xabi json correctly" $ do
      decodeXabi "test/BlockApps/Fixtures/example1.json"

    it "should decode xabi json with contract array correctly" $ do
      decodeXabi "test/BlockApps/Fixtures/example4.json"

    it "should decode xabi json with enum and structs correctly" $ do
      decodeXabi "test/BlockApps/Fixtures/example5.json"

decodeXabi :: FilePath -> Expectation
decodeXabi filePath = do
  exampleContract <- ByteString.readFile filePath
  let
    decoded :: Either String Xabi
    decoded = eitherDecode exampleContract
  decoded `shouldSatisfy` isRight
