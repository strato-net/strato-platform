{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.Parse.DeclarationsSpec where

-- import qualified Data.Text as Text

import BlockApps.Solidity.Parse.Declarations
import BlockApps.Solidity.Parse.Parser
import BlockApps.Solidity.Parse.ParserTypes
import BlockApps.Solidity.Xabi
-- import BlockApps.Solidity.Parse.UnParser
import BlockApps.Solidity.Xabi.Type
import Test.Hspec
import Text.Parsec hiding (parse)

{-# ANN module ("HLint: ignore Redundant do" :: String) #-}

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

spec :: Spec
spec = do
  describe "Declarations - functionModifiers" $ do
    it "should parse function as private" $ do
      let eRes = showError $ runParser functionModifiers "" "" "private returns (address) {}"
      printLeft eRes
      -- Right (_, visibility,  _, _)
      let visibility = case eRes of
            Right (_, visibility', _, _) -> visibility'
            Left _ -> error "should not be left"
      visibility `shouldBe` Private
  --   it "should parse function as public" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "public returns (address) {}"
  --     printLeft eRes
  --     let Right (_, visibility,  _, _) = eRes
  --     visibility `shouldBe` Public
  --   it "should parse function as internal" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "internal returns (address) {}"
  --     printLeft eRes
  --     let Right (_, visibility,  _, _) = eRes
  --     visibility `shouldBe` Internal
  --   it "should parse function as external" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "external returns (address) {}"
  --     printLeft eRes
  --     let Right (_, visibility, _, _) = eRes
  --     visibility `shouldBe` External
  --   it "should parse function as public by default" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "returns (address) {}"
  --     printLeft eRes
  --     let Right (_, visibility,  _, _) = eRes
  --     visibility `shouldBe` Public
  --   it "should parse function as constant" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "constant returns (address) {}"
  --     printLeft eRes
  --     let Right (_, _, mutability, _) = eRes
  --     mutability `shouldBe` Just Constant
  --   it "should parse function as a function mutates state" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "returns (address) {}"
  --     printLeft eRes
  --     let Right (_, _, mutability, _) = eRes
  --     mutability `shouldBe` Nothing
  --   it "should parse function with modifier onlyOwner" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "onlyOwner returns (address) {}"
  --     printLeft eRes
  --     let Right (_, _, _, modifiers) = eRes
  --     modifiers `shouldBe` ["onlyOwner"]
  --   it "should parse function with multiple modifiers" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "one ring to mod them all returns (address) {}"
  --     printLeft eRes
  --     let Right (_, _, _, modifiers) = eRes
  --     modifiers `shouldBe` ["one","ring","to","mod","them","all"]
  --   it "should parse function with correct modifiers, mutability, and visibility" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "private onlyOwner constant returns (address)"
  --     printLeft eRes
  --     let Right (_, visibility, mutability, modifiers) = eRes
  --     visibility `shouldBe` Private
  --     mutability `shouldBe` Just Constant
  --     modifiers `shouldBe` ["onlyOwner"]
  --   it "should parse function with correct base constructor" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "Base(uint a) returns (address)"
  --     printLeft eRes
  --     let Right (_, _, _, modifiers) = eRes
  --     modifiers `shouldBe` ["Base(uint a)"]
  --   it "should parse function with correct base constructor, modifiers, mutability, and visibility" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "Base(string a) private onlyOwner constant returns (address)"
  --     printLeft eRes
  --     let Right (_, visibility, mutability, modifiers) = eRes
  --     visibility `shouldBe` Private
  --     mutability `shouldBe` Just Constant
  --     modifiers `shouldBe` ["Base(string a)", "onlyOwner"]
  --   it "should parse function with correct payable modifier" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "payable returns (address)"
  --     printLeft eRes
  --     let Right (_, _, mutability, _) = eRes
  --     mutability `shouldBe` Just Payable
  --   it "should parse function with view modifier" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "view returns (uint)"
  --     printLeft eRes
  --     let Right (_, _, mutability, _) = eRes
  --     mutability `shouldBe` Just View
  --   it "should parse function with pure modifier" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "pure returns (string)"
  --     printLeft eRes
  --     let Right (_, _, mutability, _) = eRes
  --     mutability `shouldBe` Just Pure
  --   it "should parse function with correct base constructor, payable, modifiers, mutability, and visibility" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "Base(string a) private onlyOwner payable constant returns (address)"
  --     printLeft eRes
  --     let Right (_, visibility, mutability, modifiers) = eRes
  --     visibility `shouldBe` Private
  --     mutability `shouldBe` Just Payable
  --     modifiers `shouldBe` ["Base(string a)", "onlyOwner"]
  --   it "should parse function that returns two values" $ do
  --     let eRes = showError $ runParser functionModifiers "" "" "returns (ErrorCodes, ProjectState) {}"
  --     printLeft eRes
  --     let Right (rets, _, _, _) = eRes
  --         expected = [("",UnknownLabel "ErrorCodes"),("",UnknownLabel "ProjectState")]
  --     rets `shouldBe` expected
  --   it "should parse a function with nested comments" $ do
  --     let functionString = "function nestedComments(uint a)\n    { /*\n      /* nested comment\n    */\n    }"
  --         eRes = showError $ runParser functionDeclaration "" "" functionString
  --         Right (functionName, _) = eRes
  --     functionName `shouldBe` "nestedComments"
  -- describe "Declarations - structDeclaration" $ do
  --   it "should parse and unparse a struct with two fields" $ do
  --     let structString = "struct SampleStruct {\n      uint _field1;\n      string _field2;\n    }"
  --         eRes = showError $ runParser structDeclaration "" "" structString
  --         Right (structName, StructDeclaration struct) = eRes
  --         unparsedStruct = unparseTypes (Text.pack structName, struct)
  --         Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
  --     unparsedStruct `shouldBe` structString
  --     structName' `shouldBe` structName
  --     struct' `shouldBe` struct
  --   it "should parse and unparse a struct with two fields (arg names flipped)" $ do
  --     let structString = "struct SampleStruct {\n      uint _field2;\n      string _field1;\n    }"
  --         eRes = showError $ runParser structDeclaration "" "" structString
  --         Right (structName, StructDeclaration struct) = eRes
  --         unparsedStruct = unparseTypes (Text.pack structName, struct)
  --         Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
  --     unparsedStruct `shouldBe` structString
  --     structName' `shouldBe` structName
  --     struct' `shouldBe` struct
  --   it "should parse and unparse a struct with two fields (types flipped)" $ do
  --     let structString = "struct SampleStruct {\n      string _field1;\n      uint _field2;\n    }"
  --         eRes = showError $ runParser structDeclaration "" "" structString
  --         Right (structName, StructDeclaration struct) = eRes
  --         unparsedStruct = unparseTypes (Text.pack structName, struct)
  --         Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
  --     unparsedStruct `shouldBe` structString
  --     structName' `shouldBe` structName
  --     struct' `shouldBe` struct
  --   it "should parse and unparse a struct with two fields (fields flipped)" $ do
  --     let structString = "struct SampleStruct {\n      string _field2;\n      uint _field1;\n    }"
  --         eRes = showError $ runParser structDeclaration "" "" structString
  --         Right (structName, StructDeclaration struct) = eRes
  --         unparsedStruct = unparseTypes (Text.pack structName, struct)
  --         Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
  --     unparsedStruct `shouldBe` structString
  --     structName' `shouldBe` structName
  --     struct' `shouldBe` struct
  --   it "should parse and unparse a struct with three fields" $ do
  --     let structString = "struct SampleStruct {\n      uint _field1;\n      string _field2;\n      address _field3;\n    }"
  --         eRes = showError $ runParser structDeclaration "" "" structString
  --         Right (structName, StructDeclaration struct) = eRes
  --         unparsedStruct = unparseTypes (Text.pack structName, struct)
  --         Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
  --     unparsedStruct `shouldBe` structString
  --     structName' `shouldBe` structName
  --     struct' `shouldBe` struct
  --   it "should parse and unparse a struct with three fields (arg names rotated)" $ do
  --     let structString = "struct SampleStruct {\n      uint _field2;\n      string _field3;\n      address _field1;\n    }"
  --         eRes = showError $ runParser structDeclaration "" "" structString
  --         Right (structName, StructDeclaration struct) = eRes
  --         unparsedStruct = unparseTypes (Text.pack structName, struct)
  --         Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
  --     unparsedStruct `shouldBe` structString
  --     structName' `shouldBe` structName
  --     struct' `shouldBe` struct
  --   it "should parse and unparse a struct with three fields (types rotated)" $ do
  --     let structString = "struct SampleStruct {\n      string _field1;\n      address _field2;\n      uint _field3;\n    }"
  --         eRes = showError $ runParser structDeclaration "" "" structString
  --         Right (structName, StructDeclaration struct) = eRes
  --         unparsedStruct = unparseTypes (Text.pack structName, struct)
  --         Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
  --     unparsedStruct `shouldBe` structString
  --     structName' `shouldBe` structName
  --     struct' `shouldBe` struct
  --   it "should parse and unparse a struct with three fields (fields rotated)" $ do
  --     let structString = "struct SampleStruct {\n      string _field2;\n      address _field3;\n      uint _field1;\n    }"
  --         eRes = showError $ runParser structDeclaration "" "" structString
  --         Right (structName, StructDeclaration struct) = eRes
  --         unparsedStruct = unparseTypes (Text.pack structName, struct)
  --         Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
  --     unparsedStruct `shouldBe` structString
  --     structName' `shouldBe` structName
  --     struct' `shouldBe` struct
  --   it "should parse and unparse a struct with a uint8 field" $ do
  --     let structString = "struct Tile {\n      address owner;\n      address descriptorContract;\n      uint8 elevation;\n    }"
  --         eRes = showError $ runParser structDeclaration "" "" structString
  --         Right (structName, StructDeclaration struct) = eRes
  --         unparsedStruct = unparseTypes (Text.pack structName, struct)
  --         Right (structName', StructDeclaration struct') = showError $ runParser structDeclaration "" "" unparsedStruct
  --     unparsedStruct `shouldBe` structString
  --     structName' `shouldBe` structName
  --     struct' `shouldBe` struct

  describe "Declarations - solidityContract" $ do
    let xempty = xabiEmpty
    let parseContract = runParser solidityContract "" ""
    let nameOf (NamedXabi n _) = n
        nameOf _ = error "unexpected pragma or import"
    it "should parse an empty contract" $ do
      let contractString = "contract a {}"
          eRes = parseContract contractString
      eRes `shouldBe` Right (NamedXabi "a" (xempty, []))
    it "should parse an empty library" $ do
      parseContract "library l {}"
        `shouldBe` Right (NamedXabi "l" (xempty {xabiKind = LibraryKind}, []))
    it "should try 2" $ do
      parseContract "library Library {}"
        `shouldBe` Right (NamedXabi "Library" (xempty {xabiKind = LibraryKind}, []))
    it "should parse an empty interface" $ do
      parseContract "interface I {}"
        `shouldBe` Right (NamedXabi "I" (xempty {xabiKind = InterfaceKind}, []))
    it "should parse a basic contract" $ do
      let contractString =
            "\
            \contract q {\
            \    function r() {}\
            \}"
          eRes = parseContract contractString
      (nameOf <$> eRes) `shouldBe` Right "q"
    it "should parse a commented contract" $ do
      let contractString = "contract b { // don't dead open inside \n}"
          eRes = parseContract contractString
      eRes `shouldBe` Right (NamedXabi "b" (xempty, []))
    it "should parse nested a nested comments contract" $ do
      let contractString =
            "contract c { \
            \  /* this is how \
            \  function hidden () { \
            \  // bam! double comment \
            \ */ }"
          eRes = parseContract contractString
      eRes `shouldBe` Right (NamedXabi "c" (xempty, []))
    it "should parse unbalanced braces inside a string" $ do
      let contractString =
            "contract d { \
            \  function x() constant returns (string) { \
            \    return \"{\"; \
            \  } \
            \}"
          eRes = runParser solidityContract "" "" contractString
      nameOf <$> eRes `shouldBe` Right "d"

    it "should parse unbalanced parens inside a string" $ do
      let contractString =
            "contract e { \
            \  function x() constant returns (string) { \
            \    return \"(\"; \
            \  } \
            \}"
          eRes = parseContract contractString
      nameOf <$> eRes `shouldBe` Right "e"

    it "should parse unbalanced strings inside a comment" $ do
      let contractString =
            unlines
              [ "contract f { ",
                "  function x() { ",
                "    return // \"  ",
                "  } ",
                "}"
              ]
          eRes = parseContract contractString
      nameOf <$> eRes `shouldBe` Right "f"

  let isLeft (Right _) = False
      isLeft (Left _) = True
  describe "Declarations - bracedCode" $ do
    let braceParse = runParser bracedCode "" ""
    it "works in the easy case" $
      braceParse "{x}" `shouldBe` Right "x"
    it "drops an extra after brace" $
      braceParse "{y}}" `shouldBe` Right "y"
    it "fails with extra leading brace" $
      braceParse "{{z}" `shouldSatisfy` isLeft
    it "fails if end is commented out" $
      braceParse "{//whoops}" `shouldSatisfy` isLeft
    it "fails if the end is inside a string" $
      braceParse "{ return \"he}llo\"" `shouldSatisfy` isLeft
    it "parses braces inside string constants correctly" $
      braceParse "{\"}\"}" `shouldBe` Right "\"}\""
    it "ignores commented out quotation marks" $
      braceParse "{/*\"*/z}" `shouldBe` Right "z"
    it "ignores commented out quotation marks v2" $
      braceParse "{//\"\nzz}" `shouldBe` Right "zz"
    it "ignores commented out quotation marks v3" $
      braceParse "{aa//\"\n  zz}" `shouldBe` Right "aa\n  zz"
    it "ignores braces in comments" $
      braceParse "{/* { */ }" `shouldBe` Right ""
    it "shouldn't remove levels of escaping" $
      braceParse "{\"multi\\nlines\\n\"}" `shouldBe` Right "\"multi\\nlines\\n\""
    it "allows single slash for division" $
      braceParse "{x = y / 2;}" `shouldBe` Right "x = y / 2;"

  describe "Declarations - parensCode" $ do
    let parenParse = runParser parensCode "" ""
    it "works in the easy case" $
      parenParse "(x)" `shouldBe` Right "x"
    it "ignores parens in comments" $
      parenParse "(/*  ( */ )" `shouldBe` Right ""

  describe "Declarations - functions" $ do
    it "should parse a basic function" $ do
      let funcString = "function z(){}"
          eRes = runParser functionDeclaration "" "" funcString
      (fst <$> eRes) `shouldBe` Right "z"
    it "should parse a constructor" $ do
      let funcString = "constructor(){}"
          eRes = runParser functionDeclaration "Contract" "" funcString
      (fst <$> eRes) `shouldBe` Right "constructor"

  describe "Declarations - events" $ do
    it "should parse an event" $ do
      let eventString = "event MemberAdded (address member);"
          eRes = runParser eventDeclaration "" "" eventString
      (fst <$> eRes) `shouldBe` Right "MemberAdded"
    it "should parse an anonymous event" $ do
      let eventString = "event MemberAdded (address member) anonymous;"
          eRes = runParser eventDeclaration "" "" eventString
      (fst <$> eRes) `shouldBe` Right "MemberAdded"
      (snd <$> eRes) `shouldBe` Right (EventDeclaration (Event True [("member", (IndexedType 0 Address))]))
    it "should parse an event with multiple fields" $ do
      let eventString = "event MemberAdded (address indexed member, uint indexed count, string name);"
          eRes = runParser eventDeclaration "" "" eventString
      (fst <$> eRes) `shouldBe` Right "MemberAdded"
      (snd <$> eRes)
        `shouldBe` Right
          ( EventDeclaration
              ( Event
                  False
                  [ ("member", (IndexedType 0 Address)),
                    ("count", (IndexedType 1 (Int (Just False) Nothing))),
                    ("name", (IndexedType 2 (String (Just True))))
                  ]
              )
          )

  describe "Declarations - variableDeclaration" $ do
    let parseVarName = fmap fst . runParser variableDeclaration "" ""
    it "should parse a uint variable" $
      parseVarName "uint aeon;" `shouldBe` Right "aeon"
    it "should parse a constant variable" $
      parseVarName "uint constant flux;" `shouldBe` Right "flux"
    it "should parse a public variable" $
      parseVarName "uint private x;" `shouldBe` Right "x"
    it "should parse a public variable" $
      parseVarName "uint public z;" `shouldBe` Right "z"
    it "should fail a public private variable -- which is nonsense" $
      parseVarName "uint public private mixture;" `shouldSatisfy` isLeft
    it "should parse public constant -- which is sensible" $
      parseVarName "uint public constant change;" `shouldBe` Right "change"
    it "should parse constant public -- which is sensible" $
      parseVarName "uint public constant herd;" `shouldBe` Right "herd"
    it "should parse initialized constants" $
      parseVarName "uint constant start = 0xfff;" `shouldBe` Right "start"
    it "should parse initialized public public constants" $
      parseVarName "uint public public constant nothing = 0x0;" `shouldBe` Right "nothing"

  describe "Declarations - usingDeclaration" $ do
    let parseUsing = runParser usingDeclaration "" ""
    it "should parse a basic using" $
      parseUsing "using SafeMath for uint256;" `shouldBe` Right ("SafeMath", UsingDeclaration (Using "for uint256"))
    it "should fail without the keyword" $
      parseUsing "unsign SafeMath for uint256;" `shouldSatisfy` isLeft
    it "should fail without an identifier" $
      parseUsing "using 888 for uint256;" `shouldSatisfy` isLeft
    it "should fail without *some* text after the identifier" $
      parseUsing "using name;" `shouldSatisfy` isLeft
    it "should require a trailing semicolon" $
      parseUsing "using name for type" `shouldSatisfy` isLeft
    it "should not try to detect what is valid" $
      parseUsing "using name 105927)&(^!#$;" `shouldBe` Right ("name", UsingDeclaration (Using "105927)&(^!#$"))

printLeft :: Either String a -> IO ()
printLeft (Left msg) = putStrLn msg
printLeft (Right _) = return ()
