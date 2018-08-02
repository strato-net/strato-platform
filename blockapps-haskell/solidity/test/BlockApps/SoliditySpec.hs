{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.SoliditySpec where

import Test.Hspec
import Data.Aeson
import qualified Data.Aeson as Ae
import Data.Either
import qualified Data.ByteString.Lazy as ByteString
import qualified Data.Map as Map
import BlockApps.Solidity.Xabi
import BlockApps.SolidityVarReader
import BlockApps.Strato.Types()
import Test.QuickCheck

spec :: Spec
spec = do
  describe "Xabi decoding" $ do
    it "should decode simple xabi json correctly" $
      decodeXabi "test/BlockApps/Fixtures/example1.json"

    it "should decode xabi json with contract array correctly" $
      decodeXabi "test/BlockApps/Fixtures/example4.json"

    it "should decode xabi json with structs correctly" $
      decodeXabi "test/BlockApps/Fixtures/example5.json"

    it "should decode xabi json with enums correctly" $
      decodeXabi "test/BlockApps/Fixtures/example6.json"

    it "should convert a Bytestring to and from Word256" $ do
      quickCheck (\w256 -> (byteStringToWord256 $ word256ToByteString w256) == w256)

  describe "Xabi function encoding" $ do
    let fempty = Func Map.empty Map.empty Nothing Nothing Nothing Nothing
    it "should round trip xabi functions the most basic xabi function" $
      quickCheck (\f -> (eitherDecode . encode $ f) == (Right f :: Either String Func))

    it "should encode stateMutability redundantly" $ do
      let f = fempty {funcStateMutability = Just Constant}
      toJSON f `shouldBe` object ["modifiers" .= Null,
                                  "args" .= object [],
                                  "contents" .= Null,
                                  "visibility" .= Null,
                                  "payable" .= Bool False,
                                  "vals" .= object [],
                                  "stateMutability" .= String "constant",
                                  "constant" .= Bool True]

    it "should prefer stateMutability over constant/payable" $ do
      let input = object ["modifiers" .= Null,
                          "args" .= object [],
                          "contents" .= Null,
                          "visibility" .= Null,
                          "payable" .= Bool False,
                          "vals" .= object [],
                          "stateMutability" .= String "pure",
                          "constant" .= Bool True]
          want = fempty {funcStateMutability = Just Pure}
      fromJSON input `shouldBe` Ae.Success want

    it "should reconstruct stateMutability from constant&payable" $ do
      let input = object ["modifiers" .= Null,
                          "args" .= object [],
                          "contents" .= Null,
                          "visibility" .= Null,
                          "payable" .= Bool True,
                          "vals" .= object [],
                          "constant" .= Bool False]
          want = fempty {funcStateMutability = Just Payable}
      fromJSON input `shouldBe` Ae.Success want

decodeXabi :: FilePath -> Expectation
decodeXabi filePath = do
  exampleContract <- ByteString.readFile filePath
  let
    decoded :: Either String Xabi
    decoded = eitherDecode exampleContract
  decoded `shouldSatisfy` isRight
