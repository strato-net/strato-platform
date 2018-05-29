{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.Parse.DeclarationsSpec where

import qualified Data.Map as Map
import qualified Data.Text as Text
import           Test.Hspec
import           Text.Parsec                          hiding (parse)
import BlockApps.Solidity.Parse.Parser
import BlockApps.Solidity.Xabi
import BlockApps.Solidity.Parse.Declarations
import BlockApps.Solidity.Parse.UnParser
import BlockApps.Solidity.Xabi.Type

{-# ANN module ("HLint: ignore Redundant do" :: String) #-}
{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

spec :: Spec
spec = do
  describe "Declarations - functionModifiers" $ do
    it "should parse function as private" $ do
      let eRes = showError $ runParser functionModifiers "" "" "private returns (address) {}"
      printLeft eRes
      let Right (_, visibility, _, _, _) = eRes
      visibility `shouldBe` Private
    it "should parse function as public" $ do
      let eRes = showError $ runParser functionModifiers "" "" "public returns (address) {}"
      printLeft eRes
      let Right (_, visibility, _, _, _) = eRes
      visibility `shouldBe` Public
    it "should parse function as internal" $ do
      let eRes = showError $ runParser functionModifiers "" "" "internal returns (address) {}"
      printLeft eRes
      let Right (_, visibility, _, _, _) = eRes
      visibility `shouldBe` Internal
    it "should parse function as external" $ do
      let eRes = showError $ runParser functionModifiers "" "" "external returns (address) {}"
      printLeft eRes
      let Right (_, visibility, _, _, _) = eRes
      visibility `shouldBe` External
    it "should parse function as public by default" $ do
      let eRes = showError $ runParser functionModifiers "" "" "returns (address) {}"
      printLeft eRes
      let Right (_, visibility, _, _, _) = eRes
      visibility `shouldBe` Public
    it "should parse function as constant" $ do
      let eRes = showError $ runParser functionModifiers "" "" "constant returns (address) {}"
      printLeft eRes
      let Right (_, _, mutable, _, _) = eRes
      mutable `shouldBe` False
    it "should parse function as a function mutates state" $ do
      let eRes = showError $ runParser functionModifiers "" "" "returns (address) {}"
      printLeft eRes
      let Right (_, _, mutable, _, _) = eRes
      mutable `shouldBe` True
    it "should parse function with modifier onlyOwner" $ do
      let eRes = showError $ runParser functionModifiers "" "" "onlyOwner returns (address) {}"
      printLeft eRes
      let Right (_, _, _, _, modifiers) = eRes
      modifiers `shouldBe` ["onlyOwner"]
    it "should parse function with multiple modifiers" $ do
      let eRes = showError $ runParser functionModifiers "" "" "one ring to mod them all returns (address) {}"
      printLeft eRes
      let Right (_, _, _, _, modifiers) = eRes
      modifiers `shouldBe` ["one","ring","to","mod","them","all"]
    it "should parse function with correct modifiers, mutability, and visibility" $ do
      let eRes = showError $ runParser functionModifiers "" "" "private onlyOwner constant returns (address)"
      printLeft eRes
      let Right (_, visibility, mutable, _, modifiers) = eRes
      visibility `shouldBe` Private
      mutable `shouldBe` False
      modifiers `shouldBe` ["onlyOwner"]
    it "should parse function with correct base constructor" $ do
      let eRes = showError $ runParser functionModifiers "" "" "Base(uint a) returns (address)"
      printLeft eRes
      let Right (_, _, _, _, modifiers) = eRes
      modifiers `shouldBe` ["Base(uint a)"]
    it "should parse function with correct base constructor, modifiers, mutability, and visibility" $ do
      let eRes = showError $ runParser functionModifiers "" "" "Base(string a) private onlyOwner constant returns (address)"
      printLeft eRes
      let Right (_, visibility, mutable, _, modifiers) = eRes
      visibility `shouldBe` Private
      mutable `shouldBe` False
      modifiers `shouldBe` ["Base(string a)", "onlyOwner"]
    it "should parse function with correct payable modifier" $ do
      let eRes = showError $ runParser functionModifiers "" "" "payable returns (address)"
      printLeft eRes
      let Right (_, _, _, payable, _) = eRes
      payable `shouldBe` True
    it "should parse function with correct base constructor, payable, modifiers, mutability, and visibility" $ do
      let eRes = showError $ runParser functionModifiers "" "" "Base(string a) private onlyOwner payable constant returns (address)"
      printLeft eRes
      let Right (_, visibility, mutable, payable, modifiers) = eRes
      visibility `shouldBe` Private
      mutable `shouldBe` False
      payable `shouldBe` True
      modifiers `shouldBe` ["Base(string a)", "onlyOwner"]
    it "should parse function that returns two values" $ do
      let eRes = showError $ runParser functionModifiers "" "" "returns (ErrorCodes, ProjectState) {}"
      printLeft eRes
      let Right (rets, _, _, _, _) = eRes
          expected = [("",Label "ErrorCodes"),("",Label "ProjectState")]
      rets `shouldBe` expected

  describe "Declarations - structDeclaration" $ do
    it "should parse and unparse a struct with two fields" $ do
      let structString = "struct SampleStruct {\n      uint _field1;\n      string _field2;\n    }"
          eRes = showError $ runParser structDeclaration "" "" structString
          Right (structName, StructDeclaration struct) = eRes
          unparsedStruct = unparseTypes (Text.pack structName, struct)
          Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
      unparsedStruct `shouldBe` structString
      structName' `shouldBe` structName
      struct' `shouldBe` struct
    it "should parse and unparse a struct with two fields (arg names flipped)" $ do
      let structString = "struct SampleStruct {\n      uint _field2;\n      string _field1;\n    }"
          eRes = showError $ runParser structDeclaration "" "" structString
          Right (structName, StructDeclaration struct) = eRes
          unparsedStruct = unparseTypes (Text.pack structName, struct)
          Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
      unparsedStruct `shouldBe` structString
      structName' `shouldBe` structName
      struct' `shouldBe` struct
    it "should parse and unparse a struct with two fields (types flipped)" $ do
      let structString = "struct SampleStruct {\n      string _field1;\n      uint _field2;\n    }"
          eRes = showError $ runParser structDeclaration "" "" structString
          Right (structName, StructDeclaration struct) = eRes
          unparsedStruct = unparseTypes (Text.pack structName, struct)
          Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
      unparsedStruct `shouldBe` structString
      structName' `shouldBe` structName
      struct' `shouldBe` struct
    it "should parse and unparse a struct with two fields (fields flipped)" $ do
      let structString = "struct SampleStruct {\n      string _field2;\n      uint _field1;\n    }"
          eRes = showError $ runParser structDeclaration "" "" structString
          Right (structName, StructDeclaration struct) = eRes
          unparsedStruct = unparseTypes (Text.pack structName, struct)
          Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
      unparsedStruct `shouldBe` structString
      structName' `shouldBe` structName
      struct' `shouldBe` struct
    it "should parse and unparse a struct with three fields" $ do
      let structString = "struct SampleStruct {\n      uint _field1;\n      string _field2;\n      address _field3;\n    }"
          eRes = showError $ runParser structDeclaration "" "" structString
          Right (structName, StructDeclaration struct) = eRes
          unparsedStruct = unparseTypes (Text.pack structName, struct)
          Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
      unparsedStruct `shouldBe` structString
      structName' `shouldBe` structName
      struct' `shouldBe` struct
    it "should parse and unparse a struct with three fields (arg names rotated)" $ do
      let structString = "struct SampleStruct {\n      uint _field2;\n      string _field3;\n      address _field1;\n    }"
          eRes = showError $ runParser structDeclaration "" "" structString
          Right (structName, StructDeclaration struct) = eRes
          unparsedStruct = unparseTypes (Text.pack structName, struct)
          Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
      unparsedStruct `shouldBe` structString
      structName' `shouldBe` structName
      struct' `shouldBe` struct
    it "should parse and unparse a struct with three fields (types rotated)" $ do
      let structString = "struct SampleStruct {\n      string _field1;\n      address _field2;\n      uint _field3;\n    }"
          eRes = showError $ runParser structDeclaration "" "" structString
          Right (structName, StructDeclaration struct) = eRes
          unparsedStruct = unparseTypes (Text.pack structName, struct)
          Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
      unparsedStruct `shouldBe` structString
      structName' `shouldBe` structName
      struct' `shouldBe` struct
    it "should parse and unparse a struct with three fields (fields rotated)" $ do
      let structString = "struct SampleStruct {\n      string _field2;\n      address _field3;\n      uint _field1;\n    }"
          eRes = showError $ runParser structDeclaration "" "" structString
          Right (structName, StructDeclaration struct) = eRes
          unparsedStruct = unparseTypes (Text.pack structName, struct)
          Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
      unparsedStruct `shouldBe` structString
      structName' `shouldBe` structName
      struct' `shouldBe` struct

  describe "Declarations - solidityContract" $ do
    let xempty = Xabi Map.empty Map.empty Map.empty Map.empty Map.empty
    it "should parse an empty contract" $ do
      let contractString = "contract a {}"
          eRes = runParser solidityContract "" "" contractString
      eRes `shouldBe` Right ("a", (xempty, []))
    it "should parse a commented contract" $ do
      let contractString = "contract b { // don't dead open inside \n}"
          eRes = runParser solidityContract "" "" contractString
      eRes `shouldBe` Right ("b", (xempty, []))
    it "should parse nested a nested comments contract" $ do
      let contractString = "contract c { \
                           \  /* this is how \
                           \  function hidden () { \
                           \  // bam! double comment \
                           \ */ }"
          eRes = runParser solidityContract "" "" contractString
      eRes `shouldBe` Right ("c", (xempty, []))


printLeft :: Either String a -> IO ()
printLeft (Left msg) = putStrLn msg
printLeft (Right _) = return ()
