{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module StaticAnalysisSpec where

import Blockchain.DB.CodeDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.Data.AddressStateDB
import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.Strato.Model.Keccak256
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class
import Control.Monad.Trans.Class
import qualified Data.Map.Strict as M
import Data.Source
import Data.Text (Text)
import qualified Data.Text as T
import qualified SolidVM.Solidity.StaticAnalysis.Contracts.ParentConstructors as ParentConstructors
-- import qualified SolidVM.Solidity.StaticAnalysis.Typechecker                            as Typechecker
import qualified SolidVM.Solidity.StaticAnalysis.Expressions.BooleanLiterals as BooleanLiterals
import qualified SolidVM.Solidity.StaticAnalysis.Expressions.DivideBeforeMultiply as DivideBeforeMultiply
import qualified SolidVM.Solidity.StaticAnalysis.Functions.ConstantFunctions as ConstantFunctions
import qualified SolidVM.Solidity.StaticAnalysis.Pragmas.IncorrectSolidityVersion as IncorrectSolidityVersion
import qualified SolidVM.Solidity.StaticAnalysis.Statements.MultipleDeclarations as MultipleDeclarations
import qualified SolidVM.Solidity.StaticAnalysis.Statements.StateVariableShadowing as StateVariableShadowing
import qualified SolidVM.Solidity.StaticAnalysis.Statements.UninitializedLocalVariables as UninitializedLocalVariables
import qualified SolidVM.Solidity.StaticAnalysis.Statements.WriteAfterWrite as WriteAfterWrite
import SolidVM.Solidity.StaticAnalysis.Types
import qualified SolidVM.Solidity.StaticAnalysis.Variables.StateVariables as StateVariables
import Test.Hspec
import Text.RawString.QQ

instance (Keccak256 `A.Alters` DBCode) m => (Keccak256 `A.Alters` DBCode) (MainChainT (MemAddressStateDB m)) where
  lookup p = lift . lift . A.lookup p
  insert p k = lift . lift . A.insert p k
  delete p = lift . lift . A.delete p

forSource :: ParserDetector -> String -> [SourceAnnotation Text]
forSource detector c = case parseSourceWithAnnotations "" $ T.pack c of
  Left anns -> anns
  Right cc -> detector cc

forContract :: CompilerDetector -> String -> IO [SourceAnnotation Text]
forContract detector c = runNewMemCodeDB . runNewMemAddressStateDB . runMainChainT $ do
  eCC <- compileSourceWithAnnotations True (M.fromList [("", T.pack c)])
  pure $ case eCC of
    Left anns -> anns
    Right cc -> detector cc

spec :: Spec
spec = describe "Static analysis detectors" $ do
  describe "Incorrect SolidVM version detector" $ do
    it "warns when using a solidvm pragma" $
      let anns =
            IncorrectSolidityVersion.detector
              `forSource` [r|
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
    it "can call parent constructors correctly" $ do
      anns <-
        liftIO $
          ParentConstructors.detector
            `forContract` [r|
contract A {
  constructor() {
  }
}
contract B is A {
  constructor() A() {
  }
}
|]
      length anns `shouldBe` 0
    it "can detect when a contract calls a constructor it does notherit from" $ do
      anns <-
        liftIO $
          ParentConstructors.detector
            `forContract` [r|
contract A {
}
contract B {
  constructor() A() {
  }
}
|]
      length anns `shouldBe` 1
    it "can detect when a contract calls a constructor that is not scope" $ do
      anns <-
        liftIO $
          ParentConstructors.detector
            `forContract` [r|
contract B is A {
  constructor() A() {
  }
}
|]
      length anns `shouldBe` 1
    it "can detect when a contract calls a constructor that is not defined by its parent" $ do
      anns <-
        liftIO $
          ParentConstructors.detector
            `forContract` [r|
contract A {
}
contract B is A {
  constructor() A() {
  }
}
|]
      length anns `shouldBe` 1
    it "can detect when a contract calls a constructor using the wrong number of arguments" $ do
      anns <-
        liftIO $
          ParentConstructors.detector
            `forContract` [r|
contract A {
  constructor() {
  }
}
contract B is A {
  constructor() A(1) {
  }
}
|]
      length anns `shouldBe` 1

  describe "Boolean literal detectors" $ do
    it "can assign a boolean literal to a variable" $ do
      anns <-
        liftIO $
          BooleanLiterals.detector
            `forContract` [r|
contract A {
  function f() {
    bool b = true;
  }
}
|]
      length anns `shouldBe` 0
    it "can return a boolean literal from a function" $ do
      anns <-
        liftIO $
          BooleanLiterals.detector
            `forContract` [r|
contract A {
  function f() returns (bool) {
    return true;
  }
}
|]
      length anns `shouldBe` 0
    it "warns when using a boolean literal on the left side of an equality condition" $ do
      anns <-
        liftIO $
          BooleanLiterals.detector
            `forContract` [r|
contract A {
  function f(bool b) {
    if (false == b) {
      return;
    }
  }
}
|]
      length anns `shouldBe` 1
    it "warns when using a boolean literal on the right side of an equality condition" $ do
      anns <-
        liftIO $
          BooleanLiterals.detector
            `forContract` [r|
contract A {
  function f(bool b) {
    if (b == false) {
      return;
    }
  }
}
|]
      length anns `shouldBe` 1
    it "warns when using a boolean literal outside of an assignment expression" $ do
      anns <-
        liftIO $
          BooleanLiterals.detector
            `forContract` [r|
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
      length anns `shouldBe` 4

  describe "Divide before multiply detector" $ do
    it "can multiply before divide" $ do
      anns <-
        liftIO $
          DivideBeforeMultiply.detector
            `forContract` [r|
contract A {
  function f() {
    uint x = (7 * 8) / 6;
  }
}
|]
      length anns `shouldBe` 0
    it "can divide before multiply when another operation happens between the two" $ do
      anns <-
        liftIO $
          DivideBeforeMultiply.detector
            `forContract` [r|
contract A {
  function f() returns (bool) {
    uint x = ((7 / 6) + 3) * 9;
  }
}
|]
      length anns `shouldBe` 0

  describe "Constant function detectors" $ do
    it "can write pure and view functions" $ do
      anns <-
        liftIO $
          ConstantFunctions.detector
            `forContract` [r|
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
      length anns `shouldBe` 0
    it "warns when reading from contract state a pure function" $ do
      anns <-
        liftIO $
          ConstantFunctions.detector
            `forContract` [r|
contract A {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    return (x * y) / 6;
  }
}
|]
      length anns `shouldBe` 1
    it "warns when writing to contract state from a pure or view function" $ do
      anns <-
        liftIO $
          ConstantFunctions.detector
            `forContract` [r|
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
      length anns `shouldBe` 2
    it "warns when using assembly code from a pure or view function" $ do
      anns <-
        liftIO $
          ConstantFunctions.detector
            `forContract` [r|
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
      length anns `shouldBe` 2

  describe "Missingheritance detectors" $ do
    it "can resolve state variablesherited from a contract" $ do
      anns <-
        liftIO $
          ConstantFunctions.detector
            `forContract` [r|
contract A {
  uint x = 7;
}
contract B is A {
  function f() {
    x = 8;
  }
}
|]
      length anns `shouldBe` 0
    it "can resolve state variables from multiple layers ofheritance" $ do
      anns <-
        liftIO $
          ConstantFunctions.detector
            `forContract` [r|
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
      length anns `shouldBe` 0
    it "canherit from multiple contracts" $ do
      anns <-
        liftIO $
          ConstantFunctions.detector
            `forContract` [r|
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
      length anns `shouldBe` 0
    it "can detect when referencing a state variable from a non-inherited contract" $ do
      anns <-
        liftIO $
          ConstantFunctions.detector
            `forContract` [r|
contract A {
  uint x = 7;
}
contract B {
  function f() {
    x = 8;
  }
}
|]
      length anns `shouldBe` 2

  describe "State variable shadowing" $ do
    it "can create local variables that don't shadow state variable names" $ do
      anns <-
        liftIO $
          StateVariableShadowing.detector
            `forContract` [r|
contract A {
  uint x;
  function f() {
    uint y = 7;
  }
}
|]
      length anns `shouldBe` 0
    it "can create local variables that don't shadow state variable names fromherited contracts" $ do
      anns <-
        liftIO $
          StateVariableShadowing.detector
            `forContract` [r|
contract A {
  uint x;
}
contract B is A {
  function f() {
    uint y = 7;
  }
}
|]
      length anns `shouldBe` 0
    it "warns when a local variable shadows a state variable" $ do
      anns <-
        liftIO $
          StateVariableShadowing.detector
            `forContract` [r|
contract A {
  uint x;
  function f() {
    uint x = 7;
  }
}
|]
      length anns `shouldBe` 1
    it "warns when a local variable shadows a state variable from anherited contract" $ do
      anns <-
        liftIO $
          StateVariableShadowing.detector
            `forContract` [r|
contract A {
  uint x;
}
contract B is A {
  function f() {
    uint x = 7;
  }
}
|]
      length anns `shouldBe` 1

  describe "Uninitialized local variables" $ do
    it "canitialize local variables" $ do
      anns <-
        liftIO $
          UninitializedLocalVariables.detector
            `forContract` [r|
contract A {
  function f() {
    uint x = 7;
  }
}
|]
      length anns `shouldBe` 0
    it "warns when local variables are uninitialized" $ do
      anns <-
        liftIO $
          UninitializedLocalVariables.detector
            `forContract` [r|
contract A {
  function f() {
    uint x;
  }
}
|]
      length anns `shouldBe` 1
    it "warns when local variables defined a tuple are uninitialized" $ do
      anns <-
        liftIO $
          UninitializedLocalVariables.detector
            `forContract` [r|
contract A {
  function f() {
    (uint x, string y);
  }
}
|]
      length anns `shouldBe` 1

  describe "Redundant writes" $ do
    it "can write to variables" $ do
      anns <-
        liftIO $
          WriteAfterWrite.detector
            `forContract` [r|
contract A {
  function f() {
    uint x = 7;
    x += 8;
  }
}
|]
      length anns `shouldBe` 0
    it "can write to variable again after reading from it" $ do
      anns <-
        liftIO $
          WriteAfterWrite.detector
            `forContract` [r|
contract A {
  function f() {
    uint x = 7;
    uint y = x;
    x = 8;
  }
}
|]
      length anns `shouldBe` 0
    it "can apply multiple consecutive binary operations on a variable" $ do
      anns <-
        liftIO $
          WriteAfterWrite.detector
            `forContract` [r|
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
      length anns `shouldBe` 0
    it "warns when a variable is written to multiple times without being read" $ do
      anns <-
        liftIO $
          WriteAfterWrite.detector
            `forContract` [r|
contract A {
  function f() {
    uint x = 7;
    x = 8;
  }
}
|]
      length anns `shouldBe` 1
    it "warns when making consecutive writes, even after passing through a branching statement" $ do
      anns <-
        liftIO $
          WriteAfterWrite.detector
            `forContract` [r|
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
      length anns `shouldBe` 3
    it "can make a subsequent write if variable is read a conditional block" $ do
      anns <-
        liftIO $
          WriteAfterWrite.detector
            `forContract` [r|
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
      length anns `shouldBe` 0

  describe "State variable detectors" $ do
    it "can use a state variable without warning" $ do
      anns <-
        liftIO $
          StateVariables.detector
            `forContract` [r|
contract A {
  uint x = 7;
  function f(uint _x) {
    x = _x;
  }
}
|]
      length anns `shouldBe` 0
    it "warns if a state variable is unused" $ do
      anns <-
        liftIO $
          StateVariables.detector
            `forContract` [r|
contract A {
  uint x = 7;
  function f() {
  }
}
|]
      length anns `shouldBe` 1
    it "warns if a state variable is read but uninitialized" $ do
      anns <-
        liftIO $
          StateVariables.detector
            `forContract` [r|
contract A {
  uint x;
  function f() returns (uint) {
    return x;
  }
}
|]
      length anns `shouldBe` 1
    it "recommends making unmodified state variables constants" $ do
      anns <-
        liftIO $
          StateVariables.detector
            `forContract` [r|
contract A {
  uint x = 7;
  function f() returns (uint) {
    return x;
  }
}
|]
      length anns `shouldBe` 1

    it "can detect duplicate declarations" $ do
      anns <-
        liftIO $
          MultipleDeclarations.detector
            `forContract` [r|
contract A {
  function hey(){
    y = 0;
    x = "hello";
    uint z = 0;
    uint m = 1;
    uint z = 2;
  }
}
|]
      length anns `shouldBe` 3
