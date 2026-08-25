{-# LANGUAGE OverloadedStrings #-}

-- | Golden tests for the shared tx-marshaling helpers: the wallet-wrapping
-- ArgValue maps and the ArgValue → Solidity-literal rendering that both
-- posting and simulation rely on.
module TxMarshalSpec (spec) where

import Bloc.Server.Transaction (getSolidityType, walletWrapCall, walletWrapCreate)
import BlockApps.Solidity.ArgValue
import BlockApps.Solidity.Type
import BlockApps.Solidity.Value
import qualified BlockApps.Solidity.Xabi.Type as Xabi
import Blockchain.Strato.Model.Address (Address (..))
import Data.Either (isLeft)
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

  describe "numeric-string coercion (client sends big numbers as strings)" $ do
    it "parses an exact big integer string against TypeInt" $
      argValueToValue Nothing (SimpleType (TypeInt False (Just 32))) (ArgString "100000000000596833911916682269")
        `shouldBe` Right (SimpleValue (ValueInt False (Just 32) 100000000000596833911916682269))
    it "parses a high-precision decimal string against TypeDecimal" $
      argValueToValue Nothing (SimpleType TypeDecimal) (ArgString "1.00000000000596833911916682269")
        `shouldBe` Right (SimpleValue (ValueDecimal "1.00000000000596833911916682269"))
    it "rejects a non-numeric string for TypeDecimal" $
      argValueToValue Nothing (SimpleType TypeDecimal) (ArgString "not-a-number")
        `shouldSatisfy` isLeft
    it "round-trips an ambiguous string through re-marshaling" $
      -- inner marshal renders the string arg; the outer variadic re-marshal
      -- (wallet wrapping) must recover the same type and re-emit the cast
      case valueToTexts (SimpleValue $ ValueString "123") of
        [lit] -> do
          let (ty, av) = argValueToType (ArgString lit)
          ty `shouldBe` SimpleType TypeString
          argValueToValue Nothing ty av `shouldBe` Right (SimpleValue $ ValueString "123")
        other -> expectationFailure $ "expected one literal, got " ++ show other

  describe "empty arrays (an empty T[] is a legitimate value)" $ do
    it "types an empty dynamic array from the declared ABI type" $
      getSolidityType (ArgArray V.empty) (Xabi.Array (Xabi.Int Nothing (Just 32)) Nothing)
        `shouldBe` Right (TypeArrayDynamic (SimpleType (TypeInt False (Just 32))))
    it "types an empty struct array from the declared ABI type" $
      getSolidityType (ArgArray V.empty) (Xabi.Array (Xabi.Struct Nothing "S") Nothing)
        `shouldBe` Right (TypeArrayDynamic (TypeStruct "S"))
    it "types an empty array whose element type the compiler left unresolved" $
      getSolidityType (ArgArray V.empty) (Xabi.Array (Xabi.UnknownLabel "S") Nothing)
        `shouldBe` Right (TypeArrayDynamic (TypeStruct "S"))
    it "types an empty array of arrays" $
      getSolidityType (ArgArray V.empty) (Xabi.Array (Xabi.Array (Xabi.Bytes Nothing Nothing) Nothing) Nothing)
        `shouldBe` Right (TypeArrayDynamic (TypeArrayDynamic (SimpleType (TypeBytes Nothing))))
    it "still infers the element type from the value when there is one" $
      getSolidityType (ArgArray $ V.fromList [ArgObject mempty]) (Xabi.Array (Xabi.UnknownLabel "S") Nothing)
        `shouldBe` Right (TypeArrayDynamic (TypeStruct "S"))
    it "coerces an empty array to an empty value and renders it" $ do
      argValueToValue Nothing (TypeArrayDynamic (TypeStruct "S")) (ArgArray V.empty)
        `shouldBe` Right (ValueArrayDynamic mempty)
      valueToTexts (ValueArrayDynamic mempty) `shouldBe` ["[]"]
    it "still reports a length mismatch on a fixed-size array as a readable error" $
      argValueToValue Nothing (TypeArrayFixed 2 (SimpleType typeUInt)) (ArgArray V.empty)
        `shouldSatisfy` isLeft
    it "infers a type for an empty array with no declared type in reach" $
      argValueToType (ArgArray V.empty)
        `shouldBe` (TypeArrayDynamic (SimpleType typeUInt), ArgArray V.empty)

  describe "bytes args survive wallet re-marshaling" $ do
    -- The direct (no ?username=) path is the oracle: it coerces against the
    -- declared type. The wallet path then renders that Value to a literal,
    -- re-infers a type for it (User.callContract takes variadic args) and
    -- coerces again, so the round trip has to be a fixed point.
    let hex32 = "55426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750"
        direct ty av = argValueToValue Nothing ty av
        remarshal v = case valueToTexts v of
          [lit] -> let (ty, av) = argValueToType (ArgString lit) in argValueToValue Nothing ty av
          _ -> Left "expected exactly one rendered literal"
        isBytes r = case r of
          Right (SimpleValue (ValueBytes _ _)) -> True
          _ -> False
        elemCount r = case r of
          Right (ValueArrayDynamic m) -> Just . length $ unsparse m
          _ -> Nothing
    it "renders bytes in a form that names its own type" $
      (valueToTexts <$> direct (SimpleType (TypeBytes (Just 32))) (ArgString hex32))
        `shouldBe` Right ["bytes(\"" <> hex32 <> "\")"]
    it "recovers the same bytes32, not 69 characters of ASCII" $ do
      let d = direct (SimpleType (TypeBytes (Just 32))) (ArgString hex32)
      (remarshal =<< d) `shouldSatisfy` isBytes
      (valueToTexts <$> (remarshal =<< d)) `shouldBe` (valueToTexts <$> d)
    it "recovers dynamically sized bytes" $ do
      let d = direct (SimpleType (TypeBytes Nothing)) (ArgString "aabbcc")
      (remarshal =<< d) `shouldSatisfy` isBytes
      (valueToTexts <$> (remarshal =<< d)) `shouldBe` (valueToTexts <$> d)
    it "recovers a bytes[] as an array, not as one long string" $ do
      let d =
            direct
              (TypeArrayDynamic (SimpleType (TypeBytes Nothing)))
              (ArgArray $ V.fromList [ArgString "aabb", ArgString "cc"])
      (valueToTexts <$> d) `shouldBe` Right ["[bytes(\"aabb\"),bytes(\"cc\")]"]
      elemCount (remarshal =<< d) `shouldBe` Just 2
      (valueToTexts <$> (remarshal =<< d)) `shouldBe` (valueToTexts <$> d)
    it "still accepts the legacy bare hex literal" $ do
      argValueToType (ArgString "hex\"00ff\"")
        `shouldBe` (SimpleType (TypeBytes Nothing), ArgString "00ff")
      fst (argValueToType (ArgString "[hex\"aa\",hex\"bb\"]"))
        `shouldBe` TypeArrayDynamic (SimpleType (TypeBytes Nothing))
    it "does not split bracketed text whose elements are not literals" $
      argValueToType (ArgString "[not,a,literal]")
        `shouldBe` (SimpleType TypeString, ArgString "[not,a,literal]")
    it "leaves a string that merely looks like a hex literal a string" $
      -- rendered strings are quoted, so they never reach hex-literal inference
      case valueToTexts (SimpleValue $ ValueString "hex\"00ff\"") of
        [lit] -> argValueToType (ArgString lit) `shouldBe` (SimpleType TypeString, ArgString "hex\"00ff\"")
        other -> expectationFailure $ "expected one literal, got " ++ show other

  describe "splitHexLiteral" $ do
    it "accepts the forms the VM's parser accepts" $ do
      splitHexLiteral "hex\"00ff\"" `shouldBe` Just "00ff"
      splitHexLiteral "hex'00ff'" `shouldBe` Just "00ff"
    it "rejects what the VM's parser rejects" $ do
      splitHexLiteral "hex\"0\"" `shouldBe` Nothing
      splitHexLiteral "hex\"\"" `shouldBe` Nothing
      splitHexLiteral "hex\"zz\"" `shouldBe` Nothing
      splitHexLiteral "hexadecimal" `shouldBe` Nothing
      splitHexLiteral "\"hex\\\"00ff\\\"\"" `shouldBe` Nothing

  describe "splitLiteralList" $ do
    it "splits a rendered array into its top-level elements" $
      splitLiteralList "[bytes(\"aa\"),bytes(\"bb\")]"
        `shouldBe` Just ["bytes(\"aa\")", "bytes(\"bb\")"]
    it "does not split on commas inside quotes or nesting" $
      splitLiteralList "[\"a,b\",[1,2],{x:3}]" `shouldBe` Just ["\"a,b\"", "[1,2]", "{x:3}"]
    it "handles the empty list" $
      splitLiteralList "[]" `shouldBe` Just []
    it "rejects unbalanced text" $ do
      splitLiteralList "[1,2" `shouldBe` Nothing
      splitLiteralList "1,2" `shouldBe` Nothing
      splitLiteralList "[[1,2]" `shouldBe` Nothing

  describe "struct args survive wallet re-marshaling" $ do
    -- Structs render with bare field names ({a:1}), which is not JSON, so
    -- re-inference used to fall through to TypeString and hand the VM the
    -- literal text of the struct instead of the struct.
    let remarshal v = case valueToTexts v of
          [lit] -> let (ty, av) = argValueToType (ArgString lit) in argValueToValue Nothing ty av
          _ -> Left "expected exactly one rendered literal"
        beaconHeader =
          ValueStruct $
            M.fromList
              [ ("slot", SimpleValue $ valueUInt 1342),
                ("bodyRoot", SimpleValue $ ValueBytes (Just 32) "0123456789abcdef0123456789abcdef"),
                ("name", SimpleValue $ ValueString "finalized")
              ]
        isStruct r = case r of
          Right (ValueStruct _) -> True
          _ -> False
        fieldCount r = case r of
          Right (ValueStruct m) -> Just $ M.size m
          _ -> Nothing
    it "recovers a struct, not the text of one" $ do
      remarshal beaconHeader `shouldSatisfy` isStruct
      fieldCount (remarshal beaconHeader) `shouldBe` Just 3
      (valueToTexts <$> remarshal beaconHeader) `shouldBe` Right (valueToTexts beaconHeader)
    it "recovers a struct whose fields are all plain scalars" $ do
      let plain = ValueStruct $ M.fromList [("a", SimpleValue $ valueUInt 1), ("b", SimpleValue $ valueUInt 2)]
      remarshal plain `shouldSatisfy` isStruct
      (valueToTexts <$> remarshal plain) `shouldBe` Right (valueToTexts plain)
    it "recovers a struct[] (the anchorBlockHeader parentChain shape)" $ do
      let chain = ValueArrayDynamic . tosparse $ [beaconHeader, beaconHeader]
          isTwoStructs r = case r of
            Right (ValueArrayDynamic m) -> length (unsparse m) == 2
            _ -> False
      remarshal chain `shouldSatisfy` isTwoStructs
      (valueToTexts <$> remarshal chain) `shouldBe` Right (valueToTexts chain)
    it "recovers a nested struct" $ do
      let outer = ValueStruct $ M.fromList [("header", beaconHeader), ("n", SimpleValue $ valueUInt 7)]
      remarshal outer `shouldSatisfy` isStruct
      (valueToTexts <$> remarshal outer) `shouldBe` Right (valueToTexts outer)
    it "leaves a genuine string that looks like an object a string" $
      -- rendered strings are quoted, so they never reach object-literal inference
      case valueToTexts (SimpleValue $ ValueString "{a:1}") of
        [lit] -> argValueToType (ArgString lit) `shouldBe` (SimpleType TypeString, ArgString "{a:1}")
        other -> expectationFailure $ "expected one literal, got " ++ show other
    it "does not read braced text whose members are not literals as a struct" $
      argValueToType (ArgString "{a:not a literal}")
        `shouldBe` (SimpleType TypeString, ArgString "{a:not a literal}")
    it "does not read braced text without a field separator as a struct" $
      argValueToType (ArgString "{hello world}")
        `shouldBe` (SimpleType TypeString, ArgString "{hello world}")

  describe "splitObjectLiteral" $ do
    it "splits a rendered struct into field/value texts" $
      splitObjectLiteral "{a:1,b:bytes(\"aa\")}"
        `shouldBe` Just [("a", "1"), ("b", "bytes(\"aa\")")]
    it "does not split on commas or colons inside values" $
      splitObjectLiteral "{a:\"x,y\",b:{c:1},d:[1,2]}"
        `shouldBe` Just [("a", "\"x,y\""), ("b", "{c:1}"), ("d", "[1,2]")]
    it "handles the empty object" $
      splitObjectLiteral "{}" `shouldBe` Just []
    it "rejects members with no separator and unbalanced text" $ do
      splitObjectLiteral "{hello world}" `shouldBe` Nothing
      splitObjectLiteral "{a:1" `shouldBe` Nothing
      splitObjectLiteral "a:1" `shouldBe` Nothing
