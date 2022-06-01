{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
module TypecheckerSpec where

import           Blockchain.SolidVM.CodeCollectionDB
import qualified Data.Map as M
import           Data.Source
import           Data.Text (Text)
import qualified Data.Text as T
import qualified SolidVM.Solidity.Detectors.Typechecker                            as Typechecker
import           Test.Hspec
import           Text.RawString.QQ

runTypechecker :: String -> [SourceAnnotation Text]
runTypechecker c = case compileSourceWithAnnotations (M.fromList [("",T.pack c)]) of
  Left anns -> anns
  Right cc -> Typechecker.detector cc

spec :: Spec
spec = describe "Typechecker tests" $ do
  it "can declare state variables with the correct type" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 0
  it "can detect type errors in state variable declarations" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 7
  it "can declare constants with the correct type" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 0
  it "can detect type errors in constant declarations" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 7
  it "can call contract functions" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 0
  it "can call public contract functions" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 0
  it "can call external contract functions" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 0
  it "cannot call private contract functions" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 1
  it "cannot call internal contract functions" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 1
  it "can detect missing contract functions" $
    let anns = runTypechecker [r|
contract A {
}
contract B {
  constructor() {
    A a = new A();
    a.fakeFunction();
  }
}
|]
     in length anns `shouldBe` 1
  it "can access public contract state variables" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 0
  it "cannot access non-public state variables" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 1
  it "cannot access private state variables" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 1
  it "cannot access internal state variables" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 1
  it "can detect missing contract state variables" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 1
  it "can detect treating a non-function type as a function" $
    let anns = runTypechecker [r|
contract B {
  constructor(uint y) {
    y();
  }
}
|]
     in length anns `shouldBe` 1
  it "can detect treating a non-function type as a function" $
    let anns = runTypechecker [r|
contract B {
  constructor(uint y) {
    y();
  }
}
|]
     in length anns `shouldBe` 1
  it "can declare local variables of the correct type" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 0
  it "can detect type errors in local variable declarations" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 7
  it "can declare tuple types" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 0
  it "can detect arity mismatches in tuple type declarations from the left side" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 1
  it "can detect arity mismatches in tuple type declarations from the right side" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 1
  it "can detect signedness mismatch between int types" $
    let anns = runTypechecker [r|
contract A {
  function f() {
    uint x = 7;
    int y = 9;
    uint z = x + y;
  }
}
|]
     in length anns `shouldBe` 1
  it "can lookup integer index of array" $
    let anns = runTypechecker [r|
contract A {
  string[] myArray = ["one", "two", "three"];
  function f(uint i) returns (string) {
    return myArray[i];
  }
}
|]
     in length anns `shouldBe` 0
  it "cannot lookup string index of array" $
    let anns = runTypechecker [r|
contract A {
  string[] myArray = ["one", "two", "three"];
  function f(string i) {
    string x = return myArray[i];
  }
}
|]
     in length anns `shouldBe` 1
  it "can lookup value of mapping using correct key type" $
    let anns = runTypechecker [r|
contract A {
  mapping (string => uint) myMapping;
  function f(string i) returns (uint) {
    return myMapping[i];
  }
}
|]
     in length anns `shouldBe` 0
  it "cannot lookup value of mapping using incorrect key type" $
    let anns = runTypechecker [r|
contract A {
  mapping (string => uint) myMapping;
  function f(uint i) {
    uint x = myMapping[i];
  }
}
|]
     in length anns `shouldBe` 1
  it "can get array length" $
    let anns = runTypechecker [r|
contract A {
  string[] myArray;
  function f() returns (uint) {
    return myArray.length;
  }
}
|]
     in length anns `shouldBe` 0
  it "can push to an array" $
    let anns = runTypechecker [r|
contract A {
  string[] myArray;
  function f(string s) {
    myArray.push(s);
  }
}
|]
     in length anns `shouldBe` 0
  it "cannot get mapping length" $
    let anns = runTypechecker [r|
contract A {
  mapping (string => uint) myMapping;
  function f() {
    uint x = myMapping.length;
  }
}
|]
     in length anns `shouldBe` 1
  it "cannot push to a mapping" $
    let anns = runTypechecker [r|
contract A {
  mapping (string => uint) myMapping;
  function f(string s, uint i) {
    myMapping.push(s);
    myMapping.push(s, i);
    myMapping.push(i);
  }
}
|]
     in length anns `shouldBe` 3
  it "can access builtins" $
    let anns = runTypechecker [r|
contract A {
  function f() {
    address a = msg.sender;
    address b = tx.origin;
    string u = tx.username;
    string o = tx.organization;
    string g = tx.group;
    uint t = block.timestamp;
    uint n = block.number;
  }
}
|]
     in length anns `shouldBe` 0
  it "cannot change the type of builtins" $
    let anns = runTypechecker [r|
contract A {
  function f() {
    string a = msg.sender;
    uint b = tx.origin;
    address u = tx.username;
    bool o = tx.organization;
    uint g = tx.group;
    string t = block.timestamp;
    address n = block.number;
  }
}
|]
     in length anns `shouldBe` 7
  it "can call super on parent contract functions" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 0
  it "cannot call super without a parent contract" $
    let anns = runTypechecker [r|
contract A {
  function f() {
    super.fakeFunction();
  }
}
|]
     in length anns `shouldBe` 1
  it "cannot call super on missing parent contract functions" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 1
  it "cannot access missing enum elements" $
    let anns = runTypechecker [r|
contract A {
  enum E { W, X, Y, Z }
  function f() {
    E x = E.V;
  }
}
|]
     in length anns `shouldBe` 3 -- TODO: this should be 1
  it "cannot access missing struct elements" $
    let anns = runTypechecker [r|
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
     in length anns `shouldBe` 1
  it "cannot resolve unknown contracts" $
    let anns = runTypechecker [r|
contract A is B {
  constructor() B() {
  }
}
|]
     in length anns `shouldBe` 1
  it "can use 'this' keyword" $
    let anns = runTypechecker [r|
contract A {
  function f() returns (address) {
    return this;
  }
}
|]
     in length anns `shouldBe` 0
  it "can use require" $
    let anns = runTypechecker [r|
contract A {
  function f() {
    require(true, "require");
  }
}
|]
     in length anns `shouldBe` 0
  it "can use assert" $
    let anns = runTypechecker [r|
contract A {
  function f() {
    assert(true);
  }
}
|]
     in length anns `shouldBe` 0
  it "cannot use require with incorrect arguments" $
    let anns = runTypechecker [r|
contract A {
  function f() {
    require(7, "require");
    require("require");
    require(true, 7);
    require("require", true);
  }
}
|]
     in length anns `shouldSatisfy` (>=4) -- TODO: should be exactly 4
  it "cannot use assert with incorrect arguments" $
    let anns = runTypechecker [r|
contract A {
  function f() {
    assert(true, "assert");
    assert(7);
    require("assert");
  }
}
|]
     in length anns `shouldSatisfy` (>=3) -- TODO: should be exactly 3
  it "can cast to account" $ do
    let anns = runTypechecker [r|
contract A {
  function f() {
    account a = account(0xdeadbeef);
    account b = account(address(0xdeadbeef));
    account c = account(0x1234, 0x5678);
    account d = account(0x1234, "main");
    account e = account(0x1234, "self");
    account f = account(0x1234, "parent");
    account g = account(0x1234, "grandparent");
    account h = account(0x1234, "ancestor", 3);
    account i = account(address(0xdeadbeef), 0x5678);
    account j = account(address(0xdeadbeef), "main");
    account k = account(address(0xdeadbeef), "self");
    account l = account(address(0xdeadbeef), "parent");
    account m = account(address(0xdeadbeef), "grandparent");
    account n = account(address(0xdeadbeef), "ancestor", 3);
  }
}
|]
    putStrLn $ show anns
    length anns `shouldBe` 0
  it "can cast to account with incorrect types" $
    let anns = runTypechecker [r|
contract A {
  function f() {
    account a = account("1234");
    account b = account(0x1234, 0x5678, 3);
    account c = account(0x1234, 0x5678, "parent");
  }
}
|]
     in length anns `shouldSatisfy` (>=3) -- TODO: should be exactly 3
  it "can cast to account with incorrect types" $
    let anns = runTypechecker [r|
contract A {
  function f() {
    account a = account("1234");
    account b = account(0x1234, 0x5678, 3);
    account c = account(0x1234, 0x5678, "parent");
  }
}
|]
     in length anns `shouldSatisfy` (>=3) -- TODO: should be exactly 3
  it "can throw exception when the types are different from contructor and call" $
    let anns = runTypechecker [r|
contract qq {
  uint x = 0;

  constructor() {
    x = f(6,5);   
  }
  function f(string, uint) public returns (uint) {
    return 7;
  }

}|]
    in length anns `shouldBe` 1

  it "can use the string.concat(x,y) function and succeeds when the types are strings" $
    let anns = runTypechecker [r|
contract A {
  function f() {
    string x = "hello";
    string y = "world";
    string z = string.concat(x,y);
  }
}
|]
    in length anns `shouldBe` 0

  it "can use the string.concat(x,y) function and fails when the types are not strings" $
    let anns = runTypechecker [r|
contract A {
  function f() {
    string x = "hello";
    string z = string.concat(x,7);
  }
}
|]
    in length anns `shouldBe` 1
