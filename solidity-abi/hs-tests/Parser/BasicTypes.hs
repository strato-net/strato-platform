module Parser.BasicTypes (test, basicTypeTestInput) where

import Blockchain.Ethereum.Solidity.Parse hiding (bytes)
import Parser.Common
import Test.Combinators
import Test.Common

test :: TestTree
test = doTests "basicTypes" parserTest [
  intVar, intSizedVar, uintVar, uintSizedVar,
  byteVar, bytesSizedVar, bytesVar,
  boolVar, addressVar, stringVar
  ]

intVar :: ParserTestInput
intVar = basicTypeTestInput "intVar" "int" (SignedInt 32)

intSizedVar :: ParserTestInput
intSizedVar = basicTypeTestInput "intSizedVar" "int64" (SignedInt 8)

uintVar :: ParserTestInput
uintVar = basicTypeTestInput "uintVar" "uint" (UnsignedInt 32)

uintSizedVar :: ParserTestInput
uintSizedVar = basicTypeTestInput "uintSizedVar" "uint160" (UnsignedInt 20)

byteVar :: ParserTestInput
byteVar = basicTypeTestInput "byteVar" "byte" (FixedBytes 1)

bytesSizedVar :: ParserTestInput
bytesSizedVar = basicTypeTestInput "bytesSizedVar" "bytes17" (FixedBytes 17)

bytesVar :: ParserTestInput
bytesVar = basicTypeTestInput "bytesVar" "bytes" DynamicBytes

boolVar :: ParserTestInput
boolVar = basicTypeTestInput "boolVar" "bool" Boolean

addressVar :: ParserTestInput
addressVar = basicTypeTestInput "addressVar" "address" Address

stringVar :: ParserTestInput
stringVar = basicTypeTestInput "stringVar" "string" String

basicTypeTestInput :: String -> String -> SolidityBasicType -> ParserTestInput
basicTypeTestInput name typeName t = (name, source, tester) where
  source = contractDefn name $ varDecl typeName "x"
  tester solFile = varTypeIs name solFile name "x" t

