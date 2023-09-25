{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.Parse.UnParserSpec where

import BlockApps.Solidity.Parse.ParserTypes
import BlockApps.Solidity.Parse.UnParser (unparseFunc, unparseSourceUnit, unparseUsing)
import BlockApps.Solidity.Xabi
import BlockApps.Solidity.Xabi.Type
import Data.List (isInfixOf)
import qualified Data.Map.Strict as Map
import Test.Hspec

{-# ANN module ("HLint: ignore Redundant do" :: String) #-}

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

spec :: Spec
spec = do
  describe "UnParser - unparseFunc" $ do
    it "should unparse a function that returns a pair 'returns (int, uint)'" $ do
      let func =
            Func
              Map.empty
              (Map.fromList [("#0", intIndexedType), ("#1", uintIndexedType)])
              Nothing
              (Just "")
              Nothing
              Nothing
      let ret = unparseFunc ("test", func)
          expected = "function test() returns (int, uint) {\n        }"
      ret `shouldBe` expected
    it "should unparse a function that returns a pair 'returns (ErrorCodes, uint)'" $ do
      let func =
            Func
              Map.empty
              (Map.fromList [("#0", errorIndexedType), ("#1", uintIndexedType)])
              Nothing
              (Just "")
              Nothing
              Nothing
      let ret = unparseFunc ("test2", func)
          expected = "function test2() returns (ErrorCodes, uint) {\n        }"
      ret `shouldBe` expected
    it "should unparse a function that returns a pair 'returns (ErrorCodes, ProjectState)'" $ do
      let func =
            Func
              Map.empty
              (Map.fromList [("#0", errorIndexedType), ("#1", stateIndexedType)])
              Nothing
              (Just "")
              Nothing
              Nothing
      let ret = unparseFunc ("fsm", func)
          expected = "function fsm() returns (ErrorCodes, ProjectState) {\n        }"
      ret `shouldBe` expected

  describe "Unparser - library" $ do
    it "should unparse a library" $ do
      let xabi = xabiEmpty {xabiKind = LibraryKind}
      unparseSourceUnit (NamedXabi "SafeMath" (xabi, [])) `shouldSatisfy` isInfixOf "library SafeMath"
  describe "Unparser - interface" $ do
    it "should unparse an interface" $ do
      let xabi = xabiEmpty {xabiKind = InterfaceKind}
      unparseSourceUnit (NamedXabi "Stringer" (xabi, [])) `shouldSatisfy` isInfixOf "interface Stringer"
  describe "UnParser - unparseUsing" $ do
    it "should unparse using" $ do
      unparseUsing ("SafeMath", Using "for uint256") `shouldBe` "using SafeMath for uint256;\n"

expectedFunc :: String
expectedFunc =
  unlines
    [ "function fsm(ProjectState state, ProjectEvent projectEvent) returns (ErrorCodes, ProjectState) { }",
      "  if (state == ProjectState.NULL)",
      "   return (ErrorCodes.ERROR, state);",
      " if (state == ProjectState.OPEN) {",
      "   if (projectEvent == ProjectEvent.ACCEPT)",
      "     return (ErrorCodes.SUCCESS, ProjectState.PRODUCTION);",
      "  }",
      "  if (state == ProjectState.PRODUCTION) {",
      "    if (projectEvent == ProjectEvent.DELIVER)",
      "      return (ErrorCodes.SUCCESS, ProjectState.INTRANSIT);",
      "  }",
      "  if (state == ProjectState.INTRANSIT) {",
      "    if (projectEvent == ProjectEvent.RECEIVE)",
      "      return (ErrorCodes.SUCCESS, ProjectState.RECEIVED);",
      "  }",
      "  return (ErrorCodes.ERROR, state);",
      "}"
    ]

printLeft :: Either String a -> IO ()
printLeft (Left msg) = putStrLn msg
printLeft (Right _) = return ()

intIndexedType :: IndexedType
intIndexedType = IndexedType 0 (Int (Just True) Nothing)

uintIndexedType :: IndexedType
uintIndexedType = IndexedType 0 (Int Nothing Nothing)

errorIndexedType :: IndexedType
errorIndexedType =
  IndexedType
    0
    ( Enum
        (Just 8)
        "ErrorCodes"
        ( Just
            [ "NULL",
              "SUCCESS",
              "ERROR",
              "NOT_FOUND",
              "EXISTS",
              "RECURSIVE",
              "INSUFFICIENT_BALANCE"
            ]
        )
    )

stateIndexedType :: IndexedType
stateIndexedType =
  IndexedType
    0
    ( Enum
        (Just 8)
        "ProjectState"
        ( Just
            [ "NULL",
              "OPEN",
              "PRODUCTION",
              "INTRANSIT",
              "RECEIVED"
            ]
        )
    )
