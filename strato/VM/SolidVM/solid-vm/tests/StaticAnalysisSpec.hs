{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
module StaticAnalysisSpec where

import           Blockchain.SolidVM.CodeCollectionDB
import qualified Data.Map as M
import           Data.Source
import           Data.Text (Text)
import qualified Data.Text as T
import qualified SolidVM.Solidity.StaticAnalysis.Contracts.ParentConstructors           as ParentConstructors
-- import qualified SolidVM.Solidity.StaticAnalysis.Typechecker                            as Typechecker
import qualified SolidVM.Solidity.StaticAnalysis.Expressions.BooleanLiterals            as BooleanLiterals
import qualified SolidVM.Solidity.StaticAnalysis.Expressions.DivideBeforeMultiply       as DivideBeforeMultiply
import qualified SolidVM.Solidity.StaticAnalysis.Pragmas.IncorrectSolidityVersion       as IncorrectSolidityVersion
import qualified SolidVM.Solidity.StaticAnalysis.Functions.ConstantFunctions            as ConstantFunctions
import qualified SolidVM.Solidity.StaticAnalysis.Statements.StateVariableShadowing      as StateVariableShadowing
import qualified SolidVM.Solidity.StaticAnalysis.Statements.UninitializedLocalVariables as UninitializedLocalVariables
import qualified SolidVM.Solidity.StaticAnalysis.Statements.WriteAfterWrite             as WriteAfterWrite
import           SolidVM.Solidity.StaticAnalysis.Types
import qualified SolidVM.Solidity.StaticAnalysis.Variables.StateVariables               as StateVariables
import           Test.Hspec
import           Text.RawString.QQ

forSource :: ParserDetector -> String -> [SourceAnnotation Text]
forSource detector c = case parseSourceWithAnnotations "" $ T.pack c of
  Left anns -> anns
  Right cc -> detector cc

forContract :: CompilerDetector -> String -> [SourceAnnotation Text]
forContract detector c = case compileSourceWithAnnotations True (M.fromList [("",T.pack c)]) of
  Left anns -> anns
  Right cc -> detector cc

spec :: Spec
spec = describe "Static analysis detectors" $ do
  describe "Incorrect SolidVM version detector" $ do
    it "can use pragma solidvm 3.0 without warning" $
      let anns = IncorrectSolidityVersion.detector `forSource` [r|
pragma solidvm 3.0;
contract A {
  constructor() {
  }
}
|]
       in length anns `shouldBe` 0
    it "warns when using a solidvm minor version other than 3.0 or 3.2" $
      let anns = IncorrectSolidityVersion.detector `forSource` [r|
pragma solidvm 3.3;
contract A {
}
contract B {
  constructor() A() {
  }
}
|]
       in length anns `shouldBe` 1
    it "warns when using a solidvm major version other than 3.0 or 3.2" $
      let anns = IncorrectSolidityVersion.detector `forSource` [r|
pragma solidvm 4.0;
contract A {
}
contract B {
  constructor() A() {
  }
}
|]
       in length anns `shouldBe` 1

  describe "Parent constructor detectors" $ do
    it "can call parent constructors correctly" $
      let anns = ParentConstructors.detector `forContract` [r|
contract A {
  constructor() {
  }
}
contract B is A {
  constructor() A() {
  }
}
|]
       in length anns `shouldBe` 0
    it "can detect when a contract calls a constructor it does not inherit from" $
      let anns = ParentConstructors.detector `forContract` [r|
contract A {
}
contract B {
  constructor() A() {
  }
}
|]
       in length anns `shouldBe` 1
    it "can detect when a contract calls a constructor that is not in scope" $
      let anns = ParentConstructors.detector `forContract` [r|
contract B is A {
  constructor() A() {
  }
}
|]
       in length anns `shouldBe` 1
    it "can detect when a contract calls a constructor that is not defined by its parent" $
      let anns = ParentConstructors.detector `forContract` [r|
contract A {
}
contract B is A {
  constructor() A() {
  }
}
|]
       in length anns `shouldBe` 1
    it "can detect when a contract calls a constructor using the wrong number of arguments" $
      let anns = ParentConstructors.detector `forContract` [r|
contract A {
  constructor() {
  }
}
contract B is A {
  constructor() A(1) {
  }
}
|]
       in length anns `shouldBe` 1

  describe "Boolean literal detectors" $ do
    it "can assign a boolean literal to a variable" $
      let anns = BooleanLiterals.detector `forContract` [r|
contract A {
  function f() {
    bool b = true;
  }
}
|]
       in length anns `shouldBe` 0
    it "can return a boolean literal from a function" $
      let anns = BooleanLiterals.detector `forContract` [r|
contract A {
  function f() returns (bool) {
    return true;
  }
}
|]
       in length anns `shouldBe` 0
    it "warns when using a boolean literal on the left side of an equality condition" $
      let anns = BooleanLiterals.detector `forContract` [r|
contract A {
  function f(bool b) {
    if (false == b) {
      return;
    }
  }
}
|]
       in length anns `shouldBe` 1
    it "warns when using a boolean literal on the right side of an equality condition" $
      let anns = BooleanLiterals.detector `forContract` [r|
contract A {
  function f(bool b) {
    if (b == false) {
      return;
    }
  }
}
|]
       in length anns `shouldBe` 1
    it "warns when using a boolean literal outside of an assignment expression" $
      let anns = BooleanLiterals.detector `forContract` [r|
contract A {
  mapping (bool => bool) bools;
  function f(bool b) returns (bool) {
    uint x = true ? 7 : 8;
    while (true) {

    }
    for (bool b = false; b == false; b = !b) {

    }
    bool c = bools[true];
    return c;
  }
}
|]
       in length anns `shouldBe` 4

  describe "Divide before multiply detector" $ do
    it "can multiply before divide" $
      let anns = DivideBeforeMultiply.detector `forContract` [r|
contract A {
  function f() {
    uint x = (7 * 8) / 6;
  }
}
|]
       in length anns `shouldBe` 0
    it "can divide before multiply when another operation happens between the two" $
      let anns = DivideBeforeMultiply.detector `forContract` [r|
contract A {
  function f() returns (bool) {
    uint x = ((7 / 6) + 3) * 9;
  }
}
|]
       in length anns `shouldBe` 0
    it "warns when dividing before multiplying from the left" $
      let anns = DivideBeforeMultiply.detector `forContract` [r|
contract A {
  function f(bool b) {
    uint x = (7 / 6) * 9;
  }
}
|]
       in length anns `shouldBe` 1
    it "warns when dividing before multiplying from the right" $
      let anns = DivideBeforeMultiply.detector `forContract` [r|
contract A {
  function f(bool b) {
    uint x = 9 * (7 / 6);
  }
}
|]
       in length anns `shouldBe` 1

  describe "Constant function detectors" $ do
    it "can write pure and view functions" $
      let anns = ConstantFunctions.detector `forContract` [r|
contract A {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    return (7 * y) / 6;
  }
  function g(uint y) view returns (uint) {
    return (x * y) / 6;
  }
}
|]
       in length anns `shouldBe` 0
    it "warns when reading from contract state in a pure function" $
      let anns = ConstantFunctions.detector `forContract` [r|
contract A {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    return (x * y) / 6;
  }
}
|]
       in length anns `shouldBe` 1
    it "warns when writing to contract state from a pure or view function" $
      let anns = ConstantFunctions.detector `forContract` [r|
contract A {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    x = y;
    return (7 * y) / 6;
  }
  function g(uint y) view returns (uint) {
    x = y;
    return (x * y) / 6;
  }
}
|]
       in length anns `shouldBe` 2
    it "warns when using assembly code from a pure or view function" $
      let anns = ConstantFunctions.detector `forContract` [r|
contract A {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    assembly {
      x := mload (add (x, 32))
    }
  }
  function g(uint y) view returns (uint) {
    assembly {
      x := mload (add (x, 32))
    }
  }
}
|]
       in length anns `shouldBe` 2

  describe "Missing inheritance detectors" $ do
    it "can resolve state variables inherited from a contract" $
      let anns = ConstantFunctions.detector `forContract` [r|
contract A {
  uint x = 7;
}
contract B is A {
  function f() {
    x = 8;
  }
}
|]
       in length anns `shouldBe` 0
    it "can resolve state variables from multiple layers of inheritance" $
      let anns = ConstantFunctions.detector `forContract` [r|
contract A {
  uint x = 7;
}
contract B is A {
}
contract C is B {
  function f() {
    x = 8;
  }
}
|]
       in length anns `shouldBe` 0
    it "can inherit from multiple contracts" $
      let anns = ConstantFunctions.detector `forContract` [r|
contract A {
  uint x = 7;
}
contract B {
  uint y = 9;
}
contract C is A, B {
  function f() {
    x = 8;
    y = 10;
  }
}
|]
       in length anns `shouldBe` 0
    it "can detect when referencing a state variable from a non-inherited contract" $
      let anns = ConstantFunctions.detector `forContract` [r|
contract A {
  uint x = 7;
}
contract B {
  function f() {
    x = 8;
  }
}
|]
       in length anns `shouldBe` 1

  describe "State variable shadowing" $ do
    it "can create local variables that don't shadow state variable names" $
      let anns = StateVariableShadowing.detector `forContract` [r|
contract A {
  uint x;
  function f() {
    uint y = 7;
  }
}
|]
       in length anns `shouldBe` 0
    it "can create local variables that don't shadow state variable names from inherited contracts" $
      let anns = StateVariableShadowing.detector `forContract` [r|
contract A {
  uint x;
}
contract B is A {
  function f() {
    uint y = 7;
  }
}
|]
       in length anns `shouldBe` 0
    it "warns when a local variable shadows a state variable" $
      let anns = StateVariableShadowing.detector `forContract` [r|
contract A {
  uint x;
  function f() {
    uint x = 7;
  }
}
|]
       in length anns `shouldBe` 1
    it "warns when a local variable shadows a state variable from an inherited contract" $
      let anns = StateVariableShadowing.detector `forContract` [r|
contract A {
  uint x;
}
contract B is A {
  function f() {
    uint x = 7;
  }
}
|]
       in length anns `shouldBe` 1

  describe "Uninitialized local variables" $ do
    it "can initialize local variables" $
      let anns = UninitializedLocalVariables.detector `forContract` [r|
contract A {
  function f() {
    uint x = 7;
  }
}
|]
       in length anns `shouldBe` 0
    it "warns when local variables are uninitialized" $
      let anns = UninitializedLocalVariables.detector `forContract` [r|
contract A {
  function f() {
    uint x;
  }
}
|]
       in length anns `shouldBe` 1
    it "warns when local variables defined in a tuple are uninitialized" $
      let anns = UninitializedLocalVariables.detector `forContract` [r|
contract A {
  function f() {
    (uint x, string y);
  }
}
|]
       in length anns `shouldBe` 1

  describe "Redundant writes" $ do
    it "can write to variables" $
      let anns = WriteAfterWrite.detector `forContract` [r|
contract A {
  function f() {
    uint x = 7;
    x += 8;
  }
}
|]
       in length anns `shouldBe` 0
    it "can write to variable again after reading from it" $
      let anns = WriteAfterWrite.detector `forContract` [r|
contract A {
  function f() {
    uint x = 7;
    uint y = x;
    x = 8;
  }
}
|]
       in length anns `shouldBe` 0
    it "can apply multiple consecutive binary operations on a variable" $
      let anns = WriteAfterWrite.detector `forContract` [r|
contract A {
  function f() {
    uint x = 7;
    x += 8;
    x -= 8;
    x *= 8;
    x /= 8;
    x %= 8;
    x |= 8;
    x &= 8;
    x ^= 8;
  }
}
|]
       in length anns `shouldBe` 0
    it "warns when a variable is written to multiple times without being read" $
      let anns = WriteAfterWrite.detector `forContract` [r|
contract A {
  function f() {
    uint x = 7;
    x = 8;
  }
}
|]
       in length anns `shouldBe` 1
    it "warns when making consecutive writes, even after passing through a branching statement" $
      let anns = WriteAfterWrite.detector `forContract` [r|
contract A {
  function f() {
    uint x = 7;
    if (true) {
    } else {
    }
    x = 8;
    while (false) {
    }
    x = 9;
    for (uint i = 0; i > 5;) {
    }
    x = 10;
  }
}
|]
       in length anns `shouldBe` 3
    it "can make a subsequent write if variable is read in a conditional block" $
      let anns = WriteAfterWrite.detector `forContract` [r|
contract A {
  function f() {
    uint x = 7;
    if (true) {
      uint y = x;
    } else {
    }
    x = 8;
    while (true) {
      uint z = x;
      break;
    }
    x = 9;
    for (uint i = 0; i < 5; i++) {
      uint alpha = x;
    }
    x = 10;
  }
}
|]
       in length anns `shouldBe` 0

  describe "State variable detectors" $ do
    it "can use a state variable without warning" $
      let anns = StateVariables.detector `forContract` [r|
contract A {
  uint x = 7;
  function f(uint _x) {
    x = _x;
  }
}
|]
       in length anns `shouldBe` 0
    it "warns if a state variable is unused" $
      let anns = StateVariables.detector `forContract` [r|
contract A {
  uint x = 7;
  function f() {
  }
}
|]
       in length anns `shouldBe` 1
    it "warns if a state variable is read but uninitialized" $
      let anns = StateVariables.detector `forContract` [r|
contract A {
  uint x;
  function f() returns (uint) {
    return x;
  }
}
|]
       in length anns `shouldBe` 1
    it "recommends making unmodified state variables constants" $
      let anns = StateVariables.detector `forContract` [r|
contract A {
  uint x = 7;
  function f() returns (uint) {
    return x;
  }
}
|]
       in length anns `shouldBe` 1
