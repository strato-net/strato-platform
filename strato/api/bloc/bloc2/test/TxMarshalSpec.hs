{-# LANGUAGE OverloadedStrings #-}

-- | Golden tests for the shared tx-marshaling helpers: the wallet-wrapping
-- ArgValue maps and the ArgValue → Solidity-literal rendering that both
-- posting and simulation rely on.
module TxMarshalSpec (spec) where

import Bloc.Server.Transaction (walletWrapCall, walletWrapCreate)
import BlockApps.Solidity.ArgValue
import BlockApps.Solidity.Type
import BlockApps.Solidity.Value
import Blockchain.Strato.Model.Address (Address (..))
import qualified Data.Map.Strict as M
import Data.Source.Map (SourceMap (..))
import qualified Data.Vector as V
import Test.Hspec

spec :: Spec
spec = do
  describe "walletWrapCreate" $
    it "builds the exact User.createContract arg map" $ do
      let src = SourceMap [("a.sol", "contract C { constructor(uint x) {} }")]
      walletWrapCreate "C" src ["42"]
        `shouldBe` M.fromList
          [ ("contractName", ArgString "C"),
            ("contractSrc", ArgString "contract C { constructor(uint x) {} }"),
            ("args", ArgArray $ V.fromList [ArgString "42"])
          ]

  describe "walletWrapCall" $
    it "builds the exact User.callContract arg map" $
      walletWrapCall (Address 0xdeadbeef) "transfer" [ArgString "\"00000000000000000000000000000000deadbeef\"", ArgString "100"]
        `shouldBe` M.fromList
          [ ("contractToCall", ArgString "00000000000000000000000000000000deadbeef"),
            ("functionName", ArgString "transfer"),
            ("args", ArgArray $ V.fromList [ArgString "\"00000000000000000000000000000000deadbeef\"", ArgString "100"])
          ]

  describe "valueToTexts (Solidity literal rendering)" $ do
    it "renders strings quoted and escaped" $
      valueToTexts (SimpleValue . ValueString $ "he said \"hi\\there\"")
        `shouldBe` ["\"he said \\\"hi\\\\there\\\"\""]
    it "renders bools bare" $ do
      valueToTexts (SimpleValue $ ValueBool True) `shouldBe` ["true"]
      valueToTexts (SimpleValue $ ValueBool False) `shouldBe` ["false"]
    it "renders ints bare" $
      valueToTexts (SimpleValue $ valueUInt 255) `shouldBe` ["255"]
    it "renders addresses quoted without 0x" $
      valueToTexts (SimpleValue . ValueAddress $ Address 0xdeadbeef)
        `shouldBe` ["\"00000000000000000000000000000000deadbeef\""]
    it "renders dynamic arrays bracketed" $
      valueToTexts (ValueArrayFixed 2 [SimpleValue $ valueUInt 1, SimpleValue $ valueUInt 2])
        `shouldBe` ["[1,2]"]
    it "flattens variadic values into multiple args" $
      valueToTexts (ValueVariadic [SimpleValue $ valueUInt 1, SimpleValue . ValueString $ "x"])
        `shouldBe` ["1", "\"x\""]

  describe "cast-literal rendering (type-unambiguous args)" $ do
    it "wraps a string whose content the VM would re-type as an address" $
      valueToTexts (SimpleValue $ ValueString "123") `shouldBe` ["string(\"123\")"]
    it "wraps a 0x-prefixed hex string" $
      valueToTexts (SimpleValue $ ValueString "0x123") `shouldBe` ["string(\"0x123\")"]
    it "leaves exactly-40-hex content in the legacy quoted form" $
      valueToTexts (SimpleValue $ ValueString "00000000000000000000000000000000deadbeef")
        `shouldBe` ["\"00000000000000000000000000000000deadbeef\""]
    it "leaves non-address-like strings quoted" $
      valueToTexts (SimpleValue $ ValueString "hello") `shouldBe` ["\"hello\""]
    it "wraps ambiguous strings inside variadic flattening" $
      valueToTexts (ValueVariadic [SimpleValue $ ValueString "123", SimpleValue $ valueUInt 7])
        `shouldBe` ["string(\"123\")", "7"]

  describe "splitCastLiteral" $ do
    it "splits casts into keyword and raw inner text" $ do
      splitCastLiteral "string(\"123\")" `shouldBe` Just ("string", "\"123\"")
      splitCastLiteral "address(\"deadbeef\")" `shouldBe` Just ("address", "\"deadbeef\"")
      splitCastLiteral "uint(5)" `shouldBe` Just ("uint", "5")
    it "rejects non-cast text" $ do
      splitCastLiteral "\"123\"" `shouldBe` Nothing
      splitCastLiteral "stringy(\"x\")" `shouldBe` Nothing
      splitCastLiteral "123" `shouldBe` Nothing
    it "unquoteCastInner unquotes and unescapes" $ do
      unquoteCastInner "\"12\\\"3\"" `shouldBe` Just "12\"3"
      unquoteCastInner "5" `shouldBe` Nothing

  describe "argValueToType on cast literals" $ do
    it "types string casts without shape inference" $
      argValueToType (ArgString "string(\"123\")")
        `shouldBe` (SimpleType TypeString, ArgString "123")
    it "types address casts" $
      argValueToType (ArgString "address(\"0000000000000000000000000000000000000123\")")
        `shouldBe` (SimpleType TypeAddress, ArgString "0000000000000000000000000000000000000123")
    it "requires a quoted inner for string casts" $
      -- an ordinary string value that merely looks like a cast is untouched
      argValueToType (ArgString "string(hello)")
        `shouldBe` (SimpleType TypeString, ArgString "string(hello)")
    it "still infers ints for bare numeric strings (legacy)" $
      argValueToType (ArgString "123") `shouldBe` (SimpleType typeInt, ArgInt 123)
    it "round-trips an ambiguous string through re-marshaling" $
      -- inner marshal renders the string arg; the outer variadic re-marshal
      -- (wallet wrapping) must recover the same type and re-emit the cast
      case valueToTexts (SimpleValue $ ValueString "123") of
        [lit] -> do
          let (ty, av) = argValueToType (ArgString lit)
          ty `shouldBe` SimpleType TypeString
          argValueToValue Nothing ty av `shouldBe` Right (SimpleValue $ ValueString "123")
        other -> expectationFailure $ "expected one literal, got " ++ show other
