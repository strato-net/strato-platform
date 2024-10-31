{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module TypecheckerSpec where

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
import qualified SolidVM.Solidity.StaticAnalysis.Typechecker as Typechecker
import Test.Hspec
import Text.RawString.QQ
import Debug.Trace

instance (Keccak256 `A.Alters` DBCode) m => (Keccak256 `A.Alters` DBCode) (MainChainT (MemAddressStateDB m)) where
  lookup p = lift . lift . A.lookup p
  insert p k = lift . lift . A.insert p k
  delete p = lift . lift . A.delete p

runTypechecker :: String -> IO [SourceAnnotation Text]
runTypechecker c = runNewMemCodeDB . runNewMemAddressStateDB . runMainChainT $ do
  eCC <- compileSourceWithAnnotations True (M.fromList [("", T.pack c)])
  pure $ case eCC of
    Left anns -> anns
    Right cc -> Typechecker.detector cc

spec :: Spec
spec = describe "Typechecker tests" $ do
  it "can declare state variables with the correct type" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  uint x = 8;
  string y = "string";
  bool z = true;
  address a = address(0xdeadbeef);
  string[] b = ["string","array"];
  enum RestStatus { W, X, Y, Z }
  struct Complex {
    uint re;
    uint im;
  }
  RestStatus r = RestStatus.W;
  Complex i = Complex(0, 1);
}
|]

    length anns `shouldBe` 0
  it "can detect type errors in state variable declarations" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  uint x = "hello";
  string y = true;
  bool z = 8;
  address a = 42;
  string[] b = "array";
  enum RestStatus { W, X, Y, Z }
  struct Complex {
    uint re;
    uint im;
  }
  RestStatus r = Complex(0, 1);
  Complex i = RestStatus.Z;
}
|]

    length anns `shouldBe` 7
  it "can declare constants with the correct type" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  uint constant x = 8;
  string constant y = "string";
  bool constant z = true;
  address constant a = address(0xdeadbeef);
  string[] constant b = ["string","array"];
  enum RestStatus { W, X, Y, Z }
  struct Complex {
    uint re;
    uint im;
  }
  RestStatus r = RestStatus.W;
  Complex i = Complex(0, 1);
}
|]

    length anns `shouldBe` 0
  it "can detect type errors in constant declarations" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  uint constant x = "hello";
  string constant y = true;
  bool constant z = 8;
  address constant a = 42;
  string[] constant b = "array";
  enum RestStatus { W, X, Y, Z }
  struct Complex {
    uint re;
    uint im;
  }
  RestStatus r = Complex(0, 1);
  Complex i = RestStatus.Z;
}
|]

    length anns `shouldBe` 7
  it "can call contract functions" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function realFunction() {
  }
}
contract B {
  constructor() {
    A a = new A();
    a.realFunction();
  }
}
|]

    length anns `shouldBe` 0
  it "can call public contract functions" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function realFunction() public {
  }
}
contract B {
  constructor() {
    A a = new A();
    a.realFunction();
  }
}
|]

    length anns `shouldBe` 0
  it "can call external contract functions" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function realFunction() external {
  }
}
contract B {
  constructor() {
    A a = new A();
    a.realFunction();
  }
}
|]

    length anns `shouldBe` 0
  it "cannot call private contract functions" $ do
    anns <- liftIO $ runTypechecker [r|
pragma strict;

contract A {
  function realFunction() private {
  }
}
contract B {
  constructor() {
    A a = new A();
    a.realFunction();
  }
}
|]

    length anns `shouldBe` 1
  it "cannot call internal contract functions" $ do
    anns <- liftIO $ runTypechecker [r|
pragma strict;

contract A {
  function realFunction() internal {
  }
}
contract B {
  constructor() {
    A a = new A();
    a.realFunction();
  }
}
|]

    length anns `shouldBe` 1
  it "can detect missing contract functions" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
}
contract B {
  constructor() {
    A a = new A();
    a.fakeFunction();
  }
}
|]

    length anns `shouldBe` 1
  it "can access public contract state variables" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  uint public x = 75;
}
contract B {
  uint y;
  constructor() {
    A a = new A();
    y = a.x();
  }
}
|]

    length anns `shouldBe` 0
  it "cannot access non-public state variables" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  uint x = 75;
}
contract B {
  uint y;
  constructor() {
    A a = new A();
    y = a.x();
  }
}
|]

    length anns `shouldBe` 1
  it "cannot access private state variables" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  uint private x = 75;
}
contract B {
  uint y;
  constructor() {
    A a = new A();
    y = a.x();
  }
}
|]

    length anns `shouldBe` 1
  it "cannot access internal state variables" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  uint internal x = 75;
}
contract B {
  uint y;
  constructor() {
    A a = new A();
    y = a.x();
  }
}
|]

    length anns `shouldBe` 1
  it "can detect missing contract state variables" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
}
contract B {
  uint y;
  constructor() {
    A a = new A();
    y = a.x();
  }
}
|]

    length anns `shouldBe` 1
  it "can detect treating a non-function type as a function" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract B {
  constructor(uint y) {
    y();
  }
}
|]

    length anns `shouldBe` 1
  it "can detect treating a non-function type as a function" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract B {
  constructor(uint y) {
    y();
  }
}
|]

    length anns `shouldBe` 1
  it "can declare local variables of the correct type" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  enum RestStatus { W, X, Y, Z }
  struct Complex {
    uint re;
    uint im;
  }
  function f() {
    uint x = 8;
    string y = "string";
    bool z = true;
    address a = address(0xdeadbeef);
    string[] b = ["string","array"];
    RestStatus r = RestStatus.W;
    Complex i = Complex(0, 1);
  }
}
|]

    length anns `shouldBe` 0
  it "can detect type errors in local variable declarations" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  enum RestStatus { W, X, Y, Z }
  struct Complex {
    uint re;
    uint im;
  }
  function f() {
    uint x = "hello";
    string y = true;
    bool z = 8;
    address a = 42;
    string[] b = "array";
    RestStatus r = Complex(0, 1);
    Complex i = RestStatus.Z;
  }
}
|]

    length anns `shouldBe` 7
  it "can declare tuple types" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  struct Complex {
    uint re;
    uint im;
  }
  function f() {
    Complex z = Complex(0, 1);
    (uint r, uint i) = (z.re, z.im);
  }
}
|]

    length anns `shouldBe` 0
  it "can detect arity mismatches in tuple type declarations from the left side" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  struct Complex {
    uint re;
    uint im;
  }
  function f() {
    Complex x = Complex(0, 1);
    (uint re, uint im, uint z) = (x.re, x.im);
  }
}
|]

    length anns `shouldBe` 1
  it "can detect arity mismatches in tuple type declarations from the right side" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  struct Complex {
    uint re;
    uint im;
  }
  function f() {
    Complex z = Complex(0, 1);
    (uint re, uint im) = (z.re, z.im, 37);
  }
}
|]

    length anns `shouldBe` 1
  it "can detect signedness mismatch between int types" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function f() {
    uint x = 7;
    int y = 9;
    uint z = x + y;
  }
}
|]

    length anns `shouldBe` 1
  it "can lookup integer index of array" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  string[] myArray = ["one", "two", "three"];
  function f(uint i) returns (string) {
    return myArray[i];
  }
}
|]

    length anns `shouldBe` 0
  it "cannot lookup string index of array" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  string[] myArray = ["one", "two", "three"];
  function f(string i) {
    string x = return myArray[i];
  }
}
|]

    length anns `shouldBe` 1
  it "can lookup value of mapping using correct key type" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  mapping (string => uint) myMapping;
  function f(string i) returns (uint) {
    return myMapping[i];
  }
}
|]

    length anns `shouldBe` 0
  it "cannot lookup value of mapping using incorrect key type" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  mapping (string => uint) myMapping;
  function f(uint i) {
    uint x = myMapping[i];
  }
}
|]

    length anns `shouldBe` 1
  it "can get array length" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  string[] myArray;
  function f() returns (uint) {
    return myArray.length;
  }
}
|]

    length anns `shouldBe` 0
  it "can push to an array" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  string[] myArray;
  function f(string s) {
    myArray.push(s);
  }
}
|]

    length anns `shouldBe` 0
  it "cannot get mapping length" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  mapping (string => uint) myMapping;
  function f() {
    uint x = myMapping.length;
  }
}
|]

    length anns `shouldBe` 1
  it "cannot push to a mapping" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  mapping (string => uint) myMapping;
  function f(string s, uint i) {
    myMapping.push(s);
    myMapping.push(s, i);
    myMapping.push(i);
  }
}
|]

    length anns `shouldBe` 3
  it "can access builtins" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function f() {
    address a = msg.sender;
    address b = tx.origin;
    string u = tx.username;
    string o = tx.organization;
    string g = tx.organizationalUnit;
    string c = tx.certificate;
    uint t = block.timestamp;
    uint n = block.number;
  }
}
|]

    length anns `shouldBe` 0
  it "cannot change the type of builtins" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function f() {
    string a = msg.sender;
    uint b = tx.origin;
    address u = tx.username;
    bool o = tx.organization;
    uint g = tx.organizationalUnit;
    uint c = tx.certificate;
    string t = block.timestamp;
    address n = block.number;
  }
}
|]

    length anns `shouldBe` 8
  it "can call super on parent contract functions" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function realFunction() {
  }
}
contract B is A {
  function f() {
    super.realFunction();
  }
}
|]

    length anns `shouldBe` 0
  it "cannot call super without a parent contract" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function f() {
    super.fakeFunction();
  }
}
|]

    length anns `shouldBe` 1
  it "cannot call super on missing parent contract functions" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function realFunction() {
  }
}
contract B is A {
  function f() {
    super.fakeFunction();
  }
}
|]

    length anns `shouldBe` 1
  it "cannot access missing enum elements" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  enum E { W, X, Y, Z }
  function f() {
    E x = E.V;
  }
}
|]

    length anns `shouldBe` 4 -- TODO: this should be 1
  it "cannot access missing struct elements" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  struct Complex {
    uint re;
    uint im;
  }
  function f() {
    Complex i = Complex(0, 1);
    string s = i.stringVal;
  }
}
|]

    length anns `shouldBe` 1
  it "cannot resolve unknown contracts" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A is B {
  constructor() B() {
  }
}
|]

    length anns `shouldBe` 1
  it "can use 'this' keyword" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function f() returns (address) {
    return this;
  }
}
|]

    length anns `shouldBe` 0
  it "can use require" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function f() {
    require(true, "require");
  }
}
|]

    length anns `shouldBe` 0
  it "can use assert" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function f() {
    assert(true);
  }
}
|]

    length anns `shouldBe` 0
  it "cannot use require with incorrect arguments" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function f() {
    require(7, "require");
    require("require");
    require(true, 7);
    require("require", true);
  }
}
|]

    length anns `shouldSatisfy` (>= 4) -- TODO: should be exactly 4
  it "cannot use assert with incorrect arguments" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function f() {
    assert(true, "assert");
    assert(7);
    require("assert");
  }
}
|]

    length anns `shouldSatisfy` (>= 3) -- TODO: should be exactly 3
  it "can cast to account" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function f() {
    account a = account(0xdeadbeef);
    account b = account(address(0xdeadbeef));
    account c = account(0x1234, 0x5678);
    account d = account(0x1234, "main");
    account e = account(0x1234, "self");
    account f = account(0x1234, "parent");
    account i = account(address(0xdeadbeef), 0x5678);
    account j = account(address(0xdeadbeef), "main");
    account k = account(address(0xdeadbeef), "self");
    account l = account(address(0xdeadbeef), "parent");
  }
}
|]
    putStrLn $ show anns
    length anns `shouldBe` 0
  it "can cast to account with incorrect types" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function f() {
    account a = account("1234");
    account b = account(0x1234, 0x5678, 3);
    account c = account(0x1234, 0x5678, "parent");
  }
}
|]

    length anns `shouldSatisfy` (>= 3) -- TODO: should be exactly 3
  it "can cast to account with incorrect types" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  function f() {
    account a = account("1234");
    account b = account(0x1234, 0x5678, 3);
    account c = account(0x1234, 0x5678, "parent");
  }
}
|]

    length anns `shouldSatisfy` (>= 3) -- TODO: should be exactly 3
  it "can throw exception when the types are different from contructor and call" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract qq {
  uint x = 0;

  constructor() {
    x = f(6,5);   
  }
  function f(string, uint) public returns (uint) {
    return 7;
  }

}|]

    length anns `shouldBe` 1

  it "can typecheck account(this, \"self\").chainId" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract qq {
  uint a1;
  uint a2;
  uint a3;
  uint a4;
  uint a5;
  constructor() public {
    a1 = account(0xdeadbeef, 0xfeedbeef).chainId;
    a2 = account(0x123, "main").chainId;
    a3 = account(0x124, "self").chainId;
    a4 = account(0x125).chainId;
    a5 = account(this, "self").chainId;
  }
}|]

    length anns `shouldBe` 0

  it "can use the string.concat(x,y) function and succeeds when the types are strings" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract A {
  function f() {
    string x = "hello";
    string y = "world";
    string z = string.concat(x,y);
  }
}
|]

    length anns `shouldBe` 0

  it "can use the string.concat(x,y) function and fails when the types are not strings" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract A {
  function f() {
    string x = "hello";
    string z = string.concat(x,7);
  }
}
|]

    length anns `shouldBe` 1

  it "cannot assign an immutable a new value inside a function" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract A {
  unint immutable g =2;
  uint public x = 75;
  function f() {
    g = x;
  } 
}
|]

    length anns `shouldBe` 2
  it "cannot incrument an immutable already assigned within the constructor" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract qq {
  uint g = 2022;
  uint immutable d=22;
  constructor() public {
    d += g;
  }
}
|]

    length anns `shouldBe` 1
  it "can have the receive() function and succeeds when there are no arguments, no return values, and is Payable and External" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract A {
  receive() external payable {
  }
}
|]

    length anns `shouldBe` 0
  it "can throw exception when receive() function has arguments" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract A {
  receive(uint i) external payable {
    uint x = i;
  }
}
|]

    length anns `shouldBe` 1

  it "can assign a value to a declared unassigned immutable within the constructor" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract qq {
  uint g = 2022;
  uint immutable d;
  constructor() public {
    d = g;
  }
}
|]

    length anns `shouldBe` 0
  it "cannot assign an immutable a value after already assinged on contract level" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract qq {
  uint g = 2022;
  uint immutable d = 22;
  constructor() public {
    d = g;
  } 
}|]

    length anns `shouldBe` 1
  it "can throw exception when receive() function has return values" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract A {
  receive() external payable returns (uint) {
    uint x = 5;
    return x;
  }
}
|]

    length anns `shouldBe` 1

  it "can throw exception when receive() function is not external" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract A {
  receive() internal payable {
  }
}
|]

    length anns `shouldBe` 1

  it "can throw exception when receive() function is not payable" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract A {
  receive() external {
  }
}
|]

    length anns `shouldBe` 1

  it "cannot assign an immutable after already assinged within a function" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract qq {
  uint c = 2022;
  uint immutable x =c;
  constructor() {
    alterConstants();
  }
  function alterConstants(){
    x = 13;
  }
}|]

    length anns `shouldBe` 1

  it "can throw exception when receive() function is decalred with function keyword" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract A {
  function receive() external payable {
  }
}
|]

    length anns `shouldBe` 1

  it "can have the fallback() function and succeeds when there are no arguments, no return values, and is External" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
  fallback() external payable {
  }
}
|]

    length anns `shouldBe` 0

  it "can throw exception when fallback() function has arguments" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract A {
  fallback(uint i) external payable {
    uint x = i;
  }
}
|]

    length anns `shouldBe` 1

  it "can use an immutable within a function" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract qq {
  uint c = 2022;
  uint immutable public x =c;
  uint r;
  constructor() {
    alterConstants();
  }
  function alterConstants(){
    r = x;
  }
}
|]

    length anns `shouldBe` 0
  it "can throw exception when fallback() function has return values" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract A {
  fallback() external payable returns (uint) {
    uint x = 5;
    return x;
  }
}
|]

    length anns `shouldBe` 1

  it "can throw exception when fallback() function is not external" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|

contract A {
   fallback() internal payable {
  }
}
|]

    length anns `shouldBe` 1

  it "can throw exception when fallback() function is declared with function keyword" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract A {
   function fallback() external payable {
  }
}
|]

    length anns `shouldBe` 1

  it "Supports pure functions in 3.3" $ do
    anns <-
      liftIO $
        runTypechecker
          [r|
contract C {
    function f(uint a, uint b) public pure returns (uint) {
        return a * (b + 42);
    }
}
|]

    length anns `shouldBe` 0

  describe "pure and view modifier for solidvm 3.4" $ do
    it "can write pure and view functions" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
    it "error when reading from contract state in a pure function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract A {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    return (x * y) / 6;
  }
}
|]

      length anns `shouldBe` 1
    it "error when writing to contract state from a pure or view function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
    it "error when using assembly code from a pure or view function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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

  describe "Check contract inheritance solidvm 3.3" $ do
    it "can resolve state variables inherited from a contract" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
    it "can resolve state variables from multiple layers of inheritance" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
    it "can inherit from multiple contracts" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
    it "error when referencing a state variable from a non-inherited contract" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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

  -- start of 3.2 tests
  describe "pure and view modifier for solidvm 3.2" $ do
    it "can write pure and view functions" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
    it "Warns when reading from contract state in a pure function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract A {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    return (x * y) / 6;
  }
}
|]

      length anns `shouldBe` 1
    it "Warns when writing to contract state from a pure or view function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
    it "Warns when using assembly code from a pure or view function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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

  describe "Check contract inheritance" $ do
    it "can resolve state variables inherited from a contract" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
    it "can resolve state variables from multiple layers of inheritance" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
    it "can inherit from multiple contracts" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
          runTypechecker
            [r|

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

  describe "Constant function detectors" $ do
    it "can write pure and view functions" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
    it "Warns when reading from contract state in a pure function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract A {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    return (x * y) / 6;
  }
}
|]

      length anns `shouldBe` 1
    it "Warns when writing to contract state from a pure or view function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
    it "Warns when using assembly code from a pure or view function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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

  describe "Missing inheritance detectors" $ do
    it "can resolve state variables inherited from a contract" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
    it "can resolve state variables from multiple layers of inheritance" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
    it "can inherit from multiple contracts" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

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
          runTypechecker
            [r|

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

  describe "User Defined Value Types" $ do
    it "must pass the associated type within the wrap function " $ do
      anns <-
        liftIO $
          runTypechecker
            [r|
  
  type MagicInt is int;
  type MysticalString is string;
    type UBool is bool;
  contract A {
    int banana              = 12;
    MagicInt gauss          =  MagicInt.wrap(banana);
    string helper           = "1234";
    MagicInt cayley1        = MagicInt.wrap(helper);  //Should Error -- passing string var into int alias wrap function
    MagicInt cayley2        = MagicInt.wrap("12");   //Should Error  -- passing string literal into int alias wrap function
    MagicInt cayley3        = 12;                   //Should Error   -- assigning int literal to user defined type
    MagicInt yoneda         = MagicInt.wrap(12);        
    MysticalString shakeYo2 = MysticalString.wrap(yoneda); //Should Error -- passing user defined type to alias wrap function
    MagicInt felixKlein     = MagicInt.wrap(yoneda);      //Should Error  -- passing user defined type to alias wrap function
    MagicInt mrBool         = UBool.wrap(true);          //Error          -- passing wrong type to alias wrap function
    bool shouldThrowError   = UBool.wrap(true);         //Error           -- assigning user defined to bool variable
}
|]
      length anns `shouldBe` 7

    it "can use user defined unwrap and unwrap" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|
  
  
  type MagicInt       is int;
  type MysticalString is string;
  type UBool          is bool;
  contract A {
    //bool unwrapping
    UBool galois       =  UBool.wrap(false);
    bool  mrBool       =  UBool.unwrap(galois);
    bool  fermet       =  UBool.unwrap(UBool.wrap(true));
    bool  felixKlein   =  UBool.unwrap(UBool.wrap(mrBool));

    
    //Int
    MagicInt cayley   =  MagicInt.wrap(123);
    int      yoneda   =  MagicInt.unwrap(cayley);
    int      lagrange =  MagicInt.unwrap(MagicInt.wrap(123));
    MagicInt gauss    =  MagicInt.wrap(MagicInt.unwrap(MagicInt.wrap(123)));
    
    //String
    MysticalString hilbert  = MysticalString.wrap("vector");
    string         banach   = MysticalString.unwrap(hilbert);
    string krull            = MysticalString.unwrap(MysticalString.wrap(string.concat("33",  banach)));
}
|]
      length anns `shouldBe` 0

    it "can use user-defined-types wrap and unwrap within fuctions" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|
  
  type UBool is bool;
  type MagicInt is int;
  type MysticalString is string;
  contract A {
    UBool galois3  =  UBool.wrap(false);
    function f() {
       UBool galois       =  UBool.wrap(false);
       UBool galois2       =  UBool.wrap(false);
       bool  mrBool       =  UBool.unwrap(galois);
      bool  fermet       =  UBool.unwrap(UBool.wrap(true));
      bool  felixKlein   =  UBool.unwrap(UBool.wrap(mrBool));
    }

}|]
      length anns `shouldBe` 0

  describe "function tests calling other contracts" $ do
    it "can call type(C).name, type(C).creationCode, type(C).runtimeCode" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|
contract A {
  string endofunctor1 = type(A).name;
  string endofunctor2 = type(A).creationCode;
  string endofunctor3 = type(A).runtimeCode;
}

contract B {
  string endofunctor1 = type(A).name;
  string endofunctor2 = type(A).creationCode;
  string endofunctor3 = type(A).runtimeCode;
}

contract C {
  string endofunctor1 = type(A).name;
  string endofunctor2 = type(A).creationCode;
  string endofunctor3 = type(A).runtimeCode;
} |]
      length anns `shouldBe` 0

    it "type(C).name, type(C).creationCode, type(C).runtimeCode only produce strings" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|
contract A {
  int endofunctor1   = type(A).name;
  int endofunctor2   = type(A).creationCode;
  int groupoid       = type(A).runtimeCode;
}
|]
      length anns `shouldBe` 3

    it "Can only call accounts and addresses with delegate call" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|
contract A {
  int endofunctor1   = address(0xdeadbeef).delegatecall("garbage()");
  int endofunctor2   = type(A).delegatecall("garbage()");
}
|]
      length anns `shouldBe` 1

    it "Can typecheck `using` expressions" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|
library SafeMath {
  function add(uint a, uint b) returns (uint) {
    return a + b;
  }
}
contract A {
  using SafeMath for uint;
  function useUsing(uint _x) returns (uint) {
    return _x.add(1);
  }
}
|]
      anns `shouldBe` []

    it "can call own private function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract qq {
  uint x = 7;
  function myPrivateFunc() private {
    x = 8;
  }
  constructor() {
    try {
      myPrivateFunc();
    } catch {
      x = 9;
    }
  }
}
|]
      anns `shouldBe` []

    it "can't call own external function" $ do
      anns <- liftIO $ runTypechecker [r|
pragma strict;

contract qq {
  uint x = 7;
  function myExternalFunc() external {
    x = 8;
  }
  constructor() {
    try {
      myExternalFunc();
    } catch {
      x = 9;
    }
  }
}
|]
      length anns `shouldBe` 1

    it "can call own internal function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract qq {
  uint x = 7;
  function myInternalFunc() internal {
    x = 8;
  }
  constructor() {
    try {
      myInternalFunc();
    } catch {
      x = 9;
    }
  }
}
|]
      length anns `shouldBe` 0

    it "can call own public function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract qq {
  uint x = 7;
  function myPublicFunc() public {
    x = 8;
  }
  constructor() {
    try {
      myPublicFunc();
    } catch {
      x = 9;
    }
  }
}
|]
      length anns `shouldBe` 0

    it "can't call an inherited private function" $ do
      anns <- liftIO $ runTypechecker [r|
pragma strict;

contract Parent {
  uint x = 7;
  function myPrivateFunc() private {
    x = 8;
  }
}

contract qq is Parent {
  constructor() {
    try {
      myPrivateFunc();
    } catch {
      x = 9;
    }
  }
}
|]
      length anns `shouldBe` 1

    it "can't call an inherited external function" $ do
      anns <- liftIO $ runTypechecker [r|
pragma strict;

contract Parent {
  uint x = 7;
  function myExternalFunc() external {
    x = 8;
  }
}

contract qq is Parent {
  constructor() {
    try {
      myExternalFunc();
    } catch {
      x = 9;
    }
  }
}
|]
      length anns `shouldBe` 1

    it "can call an inherited internal function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract Parent {
  uint x = 7;
  function myInternalFunc() internal {
    x = 8;
  }
}

contract qq is Parent {
  constructor() {
    try {
      myInternalFunc();
    } catch {
      x = 9;
    }
  }
}
|]
      length anns `shouldBe` 0

    it "can call an inherited public function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract Parent {
  uint x = 7;
  function myPublicFunc() public {
    x = 8;
  }
}

contract qq is Parent {
  constructor() {
    try {
      myPublicFunc();
    } catch {
      x = 9;
    }
  }
}
|]
      length anns `shouldBe` 0

    it "can't call a private function in another contract" $ do
      anns <- liftIO $ runTypechecker [r|
pragma strict;

contract Parent {
  uint x = 7;
  function myPrivateFunc() private {
    x = 8;
  }
}

contract qq{
  constructor() {
      Parent p = new Parent();
      p.myPrivateFunc();
  }
}
|]
      length anns `shouldBe` 1

    it "can call an external function from another contract" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract Parent {
  uint x = 7;
  function myExternalFunc() external {
    x = 8;
  }
}

contract qq {
  constructor() {
      Parent p = new Parent();
      p.myExternalFunc();
  }
}
|]
      length anns `shouldBe` 0

    it "can't call an internal function from another contract" $ do
      anns <- liftIO $ runTypechecker [r|
pragma strict;

contract Parent {
  uint x = 7;
  function myInternalFunc() internal {
    x = 8;
  }
}

contract qq {
  constructor() {
      Parent p = new Parent();
      p.myInternalFunc();
  }
}
|]
      length anns `shouldBe` 1

    it "can call a public function from another contract" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract Parent {
  uint x = 7;
  function myPublicFunc() public {
    x = 8;
  }
}

contract qq {
  constructor() {
      Parent p = new Parent();
      p.myPublicFunc();
  }
}
|]
      length anns `shouldBe` 0
    
    it "can't use index access on an array accessor" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract SomeContract {
  uint[] public x;
  constructor() public {
    x.push(8);
  }
}

contract qq {
  constructor() {
      SomeContract p = new SomeContract();
      p.x()[0];
  }
}
|]
      length anns `shouldBe` 1
    
    it "can index access a contract array returned from a function" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract SomeContract {
  uint[] public x;
  constructor() public {
    x.push(8);
  }

  function get() returns (uint[]) {
    return x;
  }
}

contract qq {
  constructor() {
      SomeContract p = new SomeContract();
      p.get()[0];
  }
}
|]
      length anns `shouldBe` 0

    it "can pass in the index as a parameter to access a contract array" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract SomeContract {
  uint[] public x;
  constructor() public {
    x.push(8);
  }
}

contract qq {
  constructor() {
      SomeContract p = new SomeContract();
      p.x(0);
  }
}
|]
      trace (show anns) $ length anns `shouldBe` 0

    it "can typecheck a parent contract being set to a child instance" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|

contract Base { }

contract Child is Base { }

contract qq {
  constructor() {
      Base b = Base(new Child());
      Child c = new Child();
      // Base d = c;
      Base e = Base(c);
      Child f = Child(b);
  }
}
|]
      anns `shouldBe` []

    it "can typecheck accessing mappings" $ do
      anns <-
        liftIO $
          runTypechecker
            [r|
  contract Map {
    mapping (int => int) public myMap;
    constructor(int i){
        myMap[i] = i;
    }
  }

  contract qq {
    address map;
    constructor(int i){
        Map m = new Map(i);
        map = address(m);
    }

    function access(int i) returns (int){
        return Map(map).myMap(i);
    }
  }
  |]
      length anns `shouldBe` 0