{-# LANGUAGE OverloadedStrings #-}

module BlockApps.SoliditySpec where

import Test.Hspec
import Data.Aeson
import Data.Either
import qualified Data.ByteString.Lazy as ByteString
import BlockApps.Solidity.Xabi
import BlockApps.SolidityVarReader
import Test.QuickCheck

spec :: Spec
spec =
  describe "Xabi" $ do
    it "should decode simple xabi json correctly" $
      decodeXabi "test/BlockApps/Fixtures/example1.json"

    it "should decode xabi json with contract array correctly" $
      decodeXabi "test/BlockApps/Fixtures/example4.json"

    it "should decode xabi json with structs correctly" $
      decodeXabi "test/BlockApps/Fixtures/example5.json"

    it "should decode xabi json with enums correctly" $
      decodeXabi "test/BlockApps/Fixtures/example6.json"

    it "should convert a Bytestring to and from Word256" $ do
      quickCheck (\bs -> (word256ToByteString $ byteStringToWord256 bs) == bs)

decodeXabi :: FilePath -> Expectation
decodeXabi filePath = do
  exampleContract <- ByteString.readFile filePath
  let
    decoded :: Either String Xabi
    decoded = eitherDecode exampleContract
  decoded `shouldSatisfy` isRight
