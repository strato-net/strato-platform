{-# LANGUAGE OverloadedStrings #-}

module ValueEncodingSpec (spec) where

import Blockchain.Slipstream.OutputData (valueToSQLText')
import Blockchain.Slipstream.SolidityValue
import qualified BlockApps.Solidity.Value as V
import qualified Data.ByteString as B
import qualified Data.Map.Strict as Map
import Test.Hspec

spec :: Spec
spec = do
  describe "valueToSolidityValue" $ do
    it "preserves valid UTF-8 byte values" $
      valueToSolidityValue (V.SimpleValue (V.valueBytes "hello"))
        `shouldBe` Just (SolidityValueAsString "hello")

    it "hex-encodes invalid UTF-8 byte values instead of crashing" $
      valueToSolidityValue (V.SimpleValue (V.valueBytes (B.pack [0x9f])))
        `shouldBe` Just (SolidityValueAsString "9f")

  describe "question mark escaping" $ do
    it "escapes question marks embedded in struct JSON for Persistent" $
      valueToSQLText'
        True
        ( V.ValueStruct $
            Map.singleton
              "description"
              (V.SimpleValue $ V.ValueString "https://example.com/a?b=c")
        )
        `shouldBe` Just "{\"description\":\"https://example.com/a??b=c\"}"

    it "escapes question marks embedded in array JSON for Persistent" $
      valueToSQLText'
        True
        (V.ValueVariadic [V.SimpleValue $ V.ValueString "is this safe?"])
        `shouldBe` Just "[\"is this safe??\"]"
