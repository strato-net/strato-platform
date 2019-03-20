{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-unused-imports #-}
{-# OPTIONS_GHC -fno-warn-missing-fields #-}
module SolidVMSpec where

import Control.Concurrent
import Control.Concurrent.Async
import Control.Monad
import Control.Monad.Logger
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import qualified Data.ByteString.Short as SB
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Base16 as B16
import qualified Data.Map as M
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Text.Encoding
import Data.Time.Clock.POSIX
import HFlags
import Test.Hspec (hspec, Spec, describe, it, xit, pendingWith)
import Test.Hspec.Expectations.Lifted
import Text.Printf
import Text.RawString.QQ

import Blockchain.Data.DataDefs (BlockData(..))
import Blockchain.Data.ExecResults
import Blockchain.Database.MerklePatricia as MP
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SolidStorageDB
import Blockchain.DB.StateDB
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.SHA
import Blockchain.VMContext
import qualified Blockchain.SolidVM as SVM
import Executable.EVMFlags() -- for HFlags
import SolidVM.Model.Storable as MS

sender :: Address
sender = 0xdeadbeef

origin :: Address
origin = 0x8341
-- TODO: It's not clear what the difference between newAddress and uploadAddress,
-- aside from the fact that one is an argument to create and the other is generated
-- by SolidVM's create'
newAddress :: Address
newAddress = 0x0ddba11

uploadAddress :: Address
uploadAddress = getNewAddress_unsafe sender 0

secondAddress :: Address
secondAddress = getNewAddress_unsafe sender 1

devNull :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
devNull _ _ _ _ = return ()

runTest :: ContextM a -> IO ()
runTest f = do
  let timeout = 5000000
  result <- race (threadDelay timeout) $ runLoggingT (runTestContextM f) devNull
  case result of
    Left{} -> expectationFailure $ printf "test case timed out after %ds" (timeout `div` 1000000)
    Right{} -> return ()

runFile :: FilePath -> ContextM ExecResults
runFile fp = runBS =<< liftIO (B.readFile fp)

runBS :: B.ByteString -> ContextM ExecResults
runBS = runArgs "()"

runArgs :: T.Text -> B.ByteString -> ContextM ExecResults
runArgs args bs = do
  let code = Code bs
      isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      suicides = error "TODO: suicides"
      blockData = BlockData { blockDataParentHash = SHA 0x0
                            , blockDataUnclesHash = SHA 0x0
                            , blockDataCoinbase = Address 0x0
                            , blockDataStateRoot = ""
                            , blockDataTransactionsRoot = ""
                            , blockDataReceiptsRoot = ""
                            , blockDataLogBloom = ""
                            , blockDataDifficulty = 900
                            , blockDataNumber = 8033
                            , blockDataGasLimit = 1000000
                            , blockDataGasUsed = 10000
                            , blockDataExtraData = ""
                            , blockDataNonce = 22
                            , blockDataMixHash = SHA 0x0
                            , blockDataTimestamp = posixSecondsToUTCTime 0x4000 }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = error "TODO: availableGas"
      txHash = error "TODO: txHash"
      chainId = error "TODO: chainId"
      metadata = Just $ M.fromList [("name",  "qq"), ("args", args)]

  SVM.create isTest isHomestead suicides blockData callDepth sender origin
            value gasPrice availableGas newAddress code txHash chainId metadata

runCall :: T.Text -> T.Text -> B.ByteString -> ContextM ExecResults
runCall funcName callArgs bs = do
  let code = Code bs
      isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      suicides = error "TODO: suicides"
      blockData = BlockData { blockDataParentHash = SHA 0x0
                            , blockDataUnclesHash = SHA 0x0
                            , blockDataCoinbase = Address 0x0
                            , blockDataStateRoot = ""
                            , blockDataTransactionsRoot = ""
                            , blockDataReceiptsRoot = ""
                            , blockDataLogBloom = ""
                            , blockDataDifficulty = 900
                            , blockDataNumber = 8033
                            , blockDataGasLimit = 1000000
                            , blockDataGasUsed = 10000
                            , blockDataExtraData = ""
                            , blockDataNonce = 22
                            , blockDataMixHash = SHA 0x0
                            , blockDataTimestamp = posixSecondsToUTCTime 0x4000 }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = error "TODO: availableGas"
      txHash = error "TODO: txHash"
      chainId = error "TODO: chainId"
      createMetadata = Just $ M.fromList [("name",  "qq"), ("args", "()")]
      noValueTransfer = error "TODO: noValueTransfer"
      receiveAddress = error "TODO: receiveAddress"
      theData = error "TODO: theData"
      callMetadata = Just $ M.fromList [("funcName", funcName), ("args", callArgs)]
  void $ SVM.create isTest isHomestead suicides blockData callDepth sender origin
    value gasPrice availableGas newAddress code txHash chainId createMetadata
  SVM.call isTest isHomestead noValueTransfer suicides blockData callDepth receiveAddress
    uploadAddress sender value gasPrice theData availableGas origin txHash chainId callMetadata

call2 :: T.Text -> T.Text -> Address -> ContextM ExecResults
call2 funcName callArgs contractAddress = do
  let isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      suicides = error "TODO: suicides"
      blockData = BlockData { blockDataParentHash = SHA 0x0
                            , blockDataUnclesHash = SHA 0x0
                            , blockDataCoinbase = Address 0x0
                            , blockDataStateRoot = ""
                            , blockDataTransactionsRoot = ""
                            , blockDataReceiptsRoot = ""
                            , blockDataLogBloom = ""
                            , blockDataDifficulty = 900
                            , blockDataNumber = 8033
                            , blockDataGasLimit = 1000000
                            , blockDataGasUsed = 10000
                            , blockDataExtraData = ""
                            , blockDataNonce = 22
                            , blockDataMixHash = SHA 0x0
                            , blockDataTimestamp = posixSecondsToUTCTime 0x4000 }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = error "TODO: availableGas"
      txHash = error "TODO: txHash"
      chainId = error "TODO: chainId"
      noValueTransfer = error "TODO: noValueTransfer"
      receiveAddress = error "TODO: receiveAddress"
      theData = error "TODO: theData"
      callMetadata = Just $ M.fromList [("funcName", funcName), ("args", callArgs)]
  SVM.call isTest isHomestead noValueTransfer suicides blockData callDepth receiveAddress
    contractAddress sender value gasPrice theData availableGas origin txHash chainId callMetadata



defaultExecResults :: ExecResults
defaultExecResults = ExecResults
 { erRemainingTxGas = 0
 , erRefund = 0
 , erReturnVal = Just ""
 , erTrace = []
 , erLogs = []
 , erNewContractAddress = Just uploadAddress
 , erSuicideList = S.empty
 , erAction = Nothing
 , erException = Nothing
 }

defaultCallResults :: ExecResults
defaultCallResults = defaultExecResults{erNewContractAddress = Nothing}

checkStorage :: ContextM [(MP.Key, B.ByteString)]
checkStorage = flushMemRawStorageDB >> getAllRawStorageKeyVals' uploadAddress

getAll :: [[StoragePathPiece]] -> ContextM [BasicValue]
getAll = mapM (getSolidStorageKeyVal' uploadAddress . MS.fromList)

getAll2 :: [[StoragePathPiece]] -> ContextM [BasicValue]
getAll2 = mapM (getSolidStorageKeyVal' secondAddress . MS.fromList)

getFields :: [BC.ByteString] -> ContextM [BasicValue]
getFields = getAll . map (\t -> [Field t])

getFields2 :: [BC.ByteString] -> ContextM [BasicValue]
getFields2 = getAll2 . map (\t -> [Field t])

spec :: Spec
spec = do
  describe "Ballot" $ do
    it "can be created" . runTest $ do
      liftIO $ pendingWith "storage vs memory, struct kwargs"
      runFile "testdata/Ballot.sol" `shouldReturn` defaultExecResults

  describe "Create" $ do
    it "should be able to run an empty contract" . runTest $ do
      runFile "testdata/Empty.sol" `shouldReturn` defaultExecResults
      checkStorage `shouldReturn` []

    it "should be able to store a default int" . runTest $ do
      runFile "testdata/DefaultInt.sol" `shouldReturn` defaultExecResults
      checkStorage `shouldNotReturn` []

    it "should be able to explicitly store an int" . runTest $ do
      runFile "testdata/SetInt.sol" `shouldReturn` defaultExecResults
      checkStorage `shouldNotReturn` []

    it "can reduce a modulus" . runTest $ do
      void $ runFile "testdata/Modulo.sol"
      getFields ["x"] `shouldReturn` [BInteger 0xbe]


    it "should be able to store a string" . runTest $ do
      runFile "testdata/SetString.sol" `shouldReturn` defaultExecResults
      checkStorage `shouldNotReturn` []

    it "should be able to store an array" . runTest $ do
      getAll [ [Field "nums", Field "length"]
             , [Field "nums", ArrayIndex 0]
             ] `shouldReturn` [BDefault, BDefault]
      runFile "testdata/ArrayPush.sol" `shouldReturn` defaultExecResults
      st <- checkStorage
      st `shouldSatisfy` (== 2) . length
      getAll [ [Field "nums", Field "length"]
             , [Field "nums", ArrayIndex 0]
             ] `shouldReturn` [BInteger 1, BInteger 3]

    it "should be able to read an array" . runTest $ do
      checkStorage `shouldReturn` []
      runFile "testdata/ArrayRead.sol" `shouldReturn` defaultExecResults
      st <- checkStorage
      st `shouldSatisfy` (== 5) . length
      getAll
        [ [Field "xs", Field "length"]
        , [Field "xs", ArrayIndex 0]
        , [Field "xs", ArrayIndex 1]
        , [Field "xs", ArrayIndex 2]
        , [Field "y"]
        , [Field "z"]
        ] `shouldReturn` [ BInteger 2
                         , BInteger 0x5577
                         , BInteger 0xffff
                         , BDefault
                         , BInteger 0x5577
                         , BInteger 0xffff]

    it "should be able to insert into a mapping" . runTest $ do
      runFile "testdata/MappingSet.sol" `shouldReturn` defaultExecResults
      st <- checkStorage
      st `shouldSatisfy` (== 2) . length
      getAll
        [ [Field "us", MapIndex (INum 22)]
        , [Field "us", MapIndex (INum 999999)]
        , [Field "us", MapIndex (INum 10)]
        ] `shouldReturn` [BInteger 4, BInteger 21, BDefault]

    it "should be able to read from a map" . runTest $ do
      runFile "testdata/MappingRead.sol" `shouldReturn` defaultExecResults
      st <- checkStorage
      -- The z assignment doesn't count, as at is set to the empty string
      st `shouldSatisfy` (== 3) . length
      getAll
        [ [Field "xs", MapIndex (INum 400)]
        , [Field "y"]
        , [Field "z"]
        ] `shouldReturn` [BInteger 343, BInteger 343, BInteger 0]

    it "should be able to set array length" . runTest $ do
      runFile "testdata/Length.sol" `shouldReturn` defaultExecResults
      st <- checkStorage
      st `shouldSatisfy` (== 1) . length
      getAll [[Field "xs", Field "length"]] `shouldReturn` [BInteger 24]

    it "should be able to read array length" . runTest $ do
      runFile "testdata/ReadLength.sol" `shouldReturn` defaultExecResults
      st <- checkStorage
      st `shouldSatisfy` (== 2) . length
      getAll [ [Field "xs", Field "length"]
             , [Field "y"]
             ] `shouldReturn` [BInteger 0x400, BInteger 0x400]

    it "can delete" . runTest $ do
      runFile "testdata/Delete.sol" `shouldReturn` defaultExecResults
      getFields ["x"] `shouldReturn` [BDefault]

    it "can run complicated constructors" . runTest $ do
      runFile "testdata/Constructor.sol" `shouldReturn` defaultExecResults

    it "can exponentiate" . runTest $ do
      void $ runFile "testdata/Exp.sol"
      getFields ["x"] `shouldReturn` [BInteger 25]

    it "can use addresses as map keys" . runTest $ do
      void $ runFile "testdata/AddressMapping.sol"
      getAll [[Field "perms", MapIndex (IAddress 0xdeadbeef)]] `shouldReturn` [BInteger 0xfff]

    it "can hash correctly" . runTest $ do
      void $ runFile "testdata/Keccak256.sol"
      getFields ["buf1", "buf2", "hash1", "hash2"] `shouldReturn`
        [ BString (B.replicate 32 0xfe)
        , BString (BC.replicate 32 'x')
        , BString (fst $ B16.decode "59c3290d81fbdfe9ce1ffd3df2b61185e3089df0e3c49e0918e82a60acbed75a")
        , BString (fst $ B16.decode "5601c4475f2f6aa73d6a70a56f9c756f24d211a914cc7aff3fb80d2d8741c868")
        ]

    it "can create a struct" . runTest $ do
      void $ runFile "testdata/Struct.sol"
      getAll [ [Field "x", Field "a"]
             , [Field "x", Field "b"]] `shouldReturn` [BInteger 900, BString "ok"]

    it "can inline create a struct" . runTest $ do
      void $ runBS [r|
contract qq {
  struct X {
    int a;
    string b;
  }
  X x;
  constructor() {
    x.a = 900;
    x.b = "ok";
  }
}
|]
      getAll [ [Field "x", Field "a"]
             , [Field "x", Field "b"]] `shouldReturn` [BInteger 900, BString "ok"]
    it "can directy initialize a struct" . runTest $ do
      void $ runBS [r|
contract qq {
  struct X {
    int a;
    int b;
  }
  X x = X(3, 4);
}|]
      getAll [ [Field "x", Field "a"]
             , [Field "x", Field "b"]] `shouldReturn` [BInteger 3, BInteger 4]

    it "can push a struct" . runTest $ do
      void $ runBS [r|
contract qq {
  struct X {
    int a;
    int b;
  }
  X[] xs;
  constructor() {
    xs.push(X(88, 73));
  }
}
|]
      getAll [ [Field "xs"]
             , [Field "xs", Field "length"]
             , [Field "xs", ArrayIndex 0, Field "a"]
             , [Field "xs", ArrayIndex 0, Field "b"]
             ] `shouldReturn` [BDefault, BInteger 1, BInteger 88, BInteger 73]

    it "can explicitly push a struct" . runTest $ do
      void $ runBS [r|
contract qq {
  struct X {
    uint a;
    uint b;
  }
  X[] xs;
  constructor() {
    X x;
    x.a = 9000;
    x.b = 3000;
    xs.push(x);
  }
}
|]
      getAll [ [Field "xs"]
             , [Field "xs", Field "length"]
             , [Field "xs", ArrayIndex 0, Field "a"]
             , [Field "xs", ArrayIndex 0, Field "b"]
             ] `shouldReturn` [BDefault, BInteger 1, BInteger 9000, BInteger 3000]
    it "can post increment" . runTest $ do
      void $ runBS [r|
contract qq {
  uint x = 400000000;
  uint y;
  constructor() {
    y = x++;
  }
}|]
      getFields ["x", "y"] `shouldReturn` [BInteger 400000001, BInteger 400000000]

    it "can pre increment" . runTest $ do
      void $ runBS [r|
contract qq {
 uint x = 99;
 uint y = 17;
 constructor() {
   y = ++x;
  }
}|]
      getFields ["x", "y"] `shouldReturn` [BInteger 100, BInteger 100]

    it "can post decrement" . runTest $ do
      void $ runBS [r|
contract qq {
  uint x = 10;
  uint y;
  constructor() {
    y = x--;

  }
}|]
      getFields ["x", "y"] `shouldReturn` [BInteger 9, BInteger 10]

    it "can pre decrement" . runTest $ do
      void $ runBS [r|
contract qq {
  uint x = 20;
  uint y;
  constructor() {
    y = --x;
  }
}|]
      getAll [[Field "x"], [Field "y"]] `shouldReturn` [BInteger 19, BInteger 19]

    it "can require" . runTest $ do
      runBS [r|
contract qq {
  constructor() {
    require(3 == 3, "Who is John Galt?");
  }
}|] `shouldReturn` defaultExecResults

    it "can multiline require" . runTest $ do
      runBS [r|
contract qq {
  constructor() public {
    require(
      3 == 3,
      "Who is John Galt????"
    );
  }
}|] `shouldReturn` defaultExecResults

    it "can index into maps with bool" . runTest $ do
      void $ runBS [r|
contract qq {
  mapping(bool => uint) bs;
  constructor() public {
    bs[true] = 0x87324;
    bs[false] = 0x000;
  }
}|]
      getAll [ [Field "bs", MapIndex $ IBool False]
             , [Field "bs", MapIndex $ IBool True]] `shouldReturn` [BInteger 0, BInteger 0x87324]

    it "should be able to store a contract" . runTest $ do
      void $ runBS [r|
contract X {}
contract qq {
  X x = X(0x999999);
}|]
      getAll [ [Field "x"] ] `shouldReturn` [BContract "X" 0x999999]

    it "should be able to return the time from the header" . runTest $ do
      void $ runBS [r|
contract qq {
 uint ts;
 constructor() {
   ts = block.timestamp;
 }
}|]
      getAll [ [Field "ts"] ] `shouldReturn` [BInteger 0x4000]

    it "can parse one specific assembly block" . runTest $ do
      void $ runBS [r|
contract qq {
  bytes32 stored;
  constructor() {
    string source = "alright.";
    bytes32 result;
    assembly {
          result := mload(add(source, 32))
    }
    stored = result;
  }
}|]
      getAll [ [Field "stored"] ] `shouldReturn` [BString "alright."]

  it "can handle nested mappings" . runTest $ do
    void $ runBS [r|
contract qq {
  mapping(uint => mapping(uint => string)) xs;
  constructor() {
    xs[10][20] = "ok";
  }
}|]
    getAll [ [Field "xs", MapIndex (INum 10), MapIndex (INum 20)] ] `shouldReturn` [BString "ok"]

  it "can handle deeply nested mappings" . runTest $ do
    void $ runBS [r|
contract X {}
contract qq {
  mapping (bytes32 => mapping(bytes32 => mapping(bool => X))) public ruleSets;

  constructor() {
    bytes32 profileName = "profileName";
    bytes32 ruleName = "ruleName";
    ruleSets[profileName][ruleName][true] = X(0xdeadbeef);
  }
}|]
    getAll [ [ Field "ruleSets"
             , MapIndex $ IText "profileName"
             , MapIndex $ IText "ruleName"
             , MapIndex $ IBool True ] ] `shouldReturn` [BContract "X" 0xdeadbeef]

  it "can default construct local arrays" . runTest $ do
    void $ runBS [r|
contract qq {
  constructor() {
    bytes32[] mnames;
  }
}|]
    checkStorage `shouldReturn` []

  it "can array index with uninitialized numbers" . runTest $ do
    void $ runBS [r|
contract qq {
  uint[] xs;
  uint y;
  constructor() public {
    uint idx;
    y = xs[idx];
  }
}|]
    getAll [ [Field "y" ]] `shouldReturn` [BInteger 0]

  it "can map index with uninitialized numbers" . runTest $ do
    void $ runBS [r|
contract qq {
  mapping(uint => uint) xs;
  uint y;
  constructor() public {
    uint idx;
    y = xs[idx];
  }
}|]
    getAll [ [Field "y" ]] `shouldReturn` [BInteger 0]

  it "can map index with uninitialized strings" . runTest $ do
    void $ runBS [r|
contract qq {
  mapping(string => uint) xs;
  uint y;
  constructor() {
    string idx;
    y = xs[idx];
  }
}|]
    getFields ["y"] `shouldReturn` [BInteger 0]

  it "can access fields of structs from arrays" . runTest $ do
    void $ runBS [r|
contract qq {
  struct S {
    uint f;
  }
  S[] ss;
  uint y;
  constructor() {
    ss.push(S(0xdeadbeef));
    S s = ss[0];
    y = s.f;
  }
}|]
    getFields ["y"] `shouldReturn` [BInteger 0xdeadbeef]

  it "should not treat local ints as references" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x = 20;
  constructor() {
    uint l = x;
    l += 10;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 20]

  it "should remember modifications to locals" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x;
  constructor() {
    uint l = 99;
    l += 101;
    x = l;
  }
}|]
    getFields ["x"]`shouldReturn` [BInteger 200]

  it "can assign a local struct" . runTest $ do
    void $ runBS [r|
contract qq {
  uint z;
  struct X {
    uint a;
  }

  constructor() {
    X x = X(777);
    z = x.a;
  }
}|]
    getFields ["z"] `shouldReturn` [BInteger 777]

  it "can do arithmetic with defaults" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x = 0xf07;
  uint z;

  constructor() {
    uint q;
    z = x ^ q;
  }
}|]
    getFields ["x", "z"] `shouldReturn` [BInteger 0xf07, BInteger 0xf07]

  it "can read from struct references" . runTest $ do
    void $ runBS [r|
contract qq {
  struct S {
    uint si;
  }
  S[] ss;
  uint z;
  constructor() public {
    ss.push(S(222222));
    S ref = ss[0];
    z = ref.si;
  }
}|]

    getAll [ [Field "ss", Field "length"]
           , [Field "ss", ArrayIndex 0, Field "si"]
           , [Field "z"]
           ] `shouldReturn` [BInteger 1, BInteger 222222, BInteger 222222]

  it "can detect nulls" . runTest $ do
    void $ runBS [r|
contract qq {
  mapping(uint => uint) ns;
  bool found;
  constructor() {
    found = ns[0x0ddba11] != 0x0;
  }
}|]
    getFields ["found"] `shouldReturn` [BBool False]

  it "compares equal againts default" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x = 0;
  uint y;
  bool z;
  constructor() {
    z = x == y;
  }
}|]
    getFields ["x", "y", "z"] `shouldReturn` [BInteger 0, BInteger 0, BBool True]

  it "can check msg.sender" . runTest $ do
    void $ runBS [r|
contract qq {
  address x;
  constructor() {
    x = msg.sender;
  }
}|]
    getFields ["x"] `shouldReturn` [BAddress sender]

  it "can read tx.origin" . runTest $ do
    void $ runBS [r|
contract qq {
  address x;
  constructor() {
    x = tx.origin;
  }
}|]
    getFields ["x"] `shouldReturn` [BAddress origin]

  it "can infer types" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x;
  function f() returns (uint) {
    return 12345;
  }
  constructor() {
    var z = f();
    x = z;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 12345]

  it "can unpack tuples" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x;
  uint y;
  constructor() public {
    var (a, b) = (98, 7776234);
    x = a;
    y = b;
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 98, BInteger 7776234]

  it "will run parent constructors" . runTest $ do
    void $ runBS [r|
contract Parent {
  uint x;
  string name;
  constructor() public {
    x = 2346;
    name = "Sandman";
  }
}

contract qq is Parent {
  constructor() public Parent() {}
}|]
    getFields ["x", "name"] `shouldReturn` [BInteger 2346, BString "Sandman"]

  it "will pass arguments to constructors" . runTest $ do
    void $ runArgs "(0x6662346)" [r|
contract qq {
  address target;
  constructor(address _target) public {
    target = _target;
  }
}|]
    getFields ["target"] `shouldReturn` [BAddress 0x6662346]

  it "can create a reference to a map value" . runTest $ do
    void $ runBS [r|
contract qq {
  mapping (bytes32 => bytes32[]) ruleNames;

  constructor() public {
    bytes32[] names = ruleNames["ok"];
    names.push("1");
  }
}|]
    getAll [ [Field "ruleNames", MapIndex (IText "ok"), Field "length"]
           , [Field "ruleNames", MapIndex (IText "ok"), ArrayIndex 0]
           ] `shouldReturn` [BInteger 1, BString "1"]

  it "can back assign a reference" . runTest $ do
    void $ runBS [r|
contract qq {
  bytes32[] src;
  bytes32[] dst;
  constructor() public {
    bytes32[] src2 = src;
    src2.push("red");
    dst = src2;
    // src2 still refers to src, but dst had a deep copy
    src2.push("blue");
  }
}|]
    getAll [ [Field "src", Field "length"]
           , [Field "src", ArrayIndex 0]
           , [Field "src", ArrayIndex 1]
           , [Field "dst", Field "length"]
           , [Field "dst", ArrayIndex 0]
           ] `shouldReturn` [ BInteger 2, BString "red", BString "blue"
                            , BInteger 1, BString "red"]

  it "can back assign a map value reference" . runTest $ do
    void $ runBS [r|
contract qq {
  mapping (bytes32 => bytes32[]) ruleNames;

  constructor() public {
    bytes32[] names = ruleNames["ok"];
    names.push("red");
    ruleNames["bad"] = names;
  }
}|]

  it "can continue" . runTest $ do
    liftIO $ pendingWith "implement continue"
    void $ runBS [r|
contract qq {
  uint i;
  constructor() public {
    for (i = 0; i < 100; i++) {
      continue;
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 100]

  it "can call functions on local contracts" . runTest $ do
    void $ runBS [r|
contract Auth {
  function check(address _to_check) public returns (bool) {
    return _to_check == 0xdeadbeef;
  }
}

contract qq {
  bool auth;
  constructor() {
    Auth a = new Auth();
    auth = a.check(msg.sender);
  }
}|]
    getFields ["auth"] `shouldReturn` [BBool True]

  it "can call functions on stored contracts" . runTest $ do
    void $ runBS [r|
contract Auth {
  function check(address _to_check) public returns (bool) {
    return _to_check == 0xdeadbeef;
  }
}

contract qq {
  Auth a;
  bool auth;
  constructor() {
    a = new Auth();
    auth = a.check(msg.sender);
  }
}|]
    getFields ["auth"] `shouldReturn` [BBool True]

  it "can inherit storage" . runTest $ do
    void $ runBS [r|
contract Parent {
  uint public x = 3;
}

contract qq is Parent {
  uint y = 999;
}|]
    getFields ["x", "y"]` shouldReturn` [BInteger 3, BInteger 999]

  it "can call functions" . runTest $ do
    void $ runCall "inc" "()" [r|
contract qq {
  uint x = 99;
  function inc() {
    x++;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 100]

  it "can cast address to contract" . runTest $ do
    void $ runBS [r|
contract X {}
contract qq {
  X x;
  constructor() public {
    x = X(0xdeadbeef);
  }
}|]
    getFields ["x"] `shouldReturn` [BContract "X" 0xdeadbeef]

  it "can call methods of superclasses" . runTest $ do
    void $ runBS [r|
contract P {
  function callable() public {}
}
contract qq is P {
  uint x;
  constructor() public {
    P.callable();
    x  = 774;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 774]

  it "can use super to call parent methods" . runTest $ do
    void $ runBS [r|
contract P {
  function callable() public {}
}
contract qq is P {
  uint x;
  constructor() public {
    super.callable();
    x = 908;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 908]

  it "can treat 0 literals as strings" . runTest $ do
    void $ runBS [r|
contract qq {
  bytes32 text = "ok";
  bytes32 notext = "";
  bytes32 zero = 0;
  bool nonempty;
  bool empty;
  constructor() {
    nonempty = text == 0;
    empty = notext == 0;
  }
}|]
    getFields ["text", "notext", "zero", "nonempty", "empty"] `shouldReturn`
              [BString "ok", BString "", BString "", BBool False, BBool True]

  it "can treat integer literals as addresses" . runTest $ do
    void $ runBS [r|
contract qq {
  address a = 0xdeadbeef;
}|]
    getFields ["a"] `shouldReturn` [BAddress 0xdeadbeef]

  it "can pass arrays by reference to functions" . runTest $ do
    void $ runBS [r|
contract qq {
  uint[] xs;
  uint x;
  function head(uint[] ts) returns (uint) {
    return ts[0];
  }
  constructor() public {
    xs.push(0x44444);
    x = head(xs);
  }
}|]
    getAll [ [Field "xs", Field "length"]
           , [Field "xs", ArrayIndex 0]
           , [Field "x"]
           ] `shouldReturn` [BInteger 1, BInteger 0x44444, BInteger 0x44444]

  it "can pass arrays by reference to other contracts" . runTest $ do
    void $ runBS [r|
contract H {
  function head(uint[] ts) returns (uint) {
    return ts[0];
  }
}
contract qq {
  uint[] xs;
  uint x;
  constructor() public {
    H h = new H();
    xs.push(23145);
    x = h.head(xs) + 1;
  }
}|]
    getAll [ [Field "xs", Field "length"]
           , [Field "xs", ArrayIndex 0]
           , [Field "x"]
           ] `shouldReturn` [BInteger 1, BInteger 23145, BInteger 23146]

  it "can accept remote arrays" . runTest $ do
    void $ runCall "addHead" "([10, 17])" [r|
contract qq {
  uint x;
  function addHead(uint[] ts) public {
    x += ts[0];
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 10]


  it "can store array literals" . runTest $ do
    void $ runBS [r|
contract qq {
  uint[] xs = [10, 20, 90];
}|]
    getAll [ [Field "xs", Field "length"]
           , [Field "xs", ArrayIndex 0]
           , [Field "xs", ArrayIndex 1]
           , [Field "xs", ArrayIndex 2]
           ] `shouldReturn` [BInteger 3, BInteger 10, BInteger 20, BInteger 90]

  it "can accept nested arrays" . runTest $ do
    void $ runBS [r|
contract qq {
  bool[2][] pairs;

  function setPairs(bool[2][] _pairs) {
    pairs = _pairs;
  }
  constructor() public {
    setPairs([[true, false], [false, false], [true, true]]);
  }
}|]
    let subArrays = do
          pre <- map ArrayIndex [0, 1, 2]
          suf <- [Field "length", ArrayIndex 0, ArrayIndex 1]
          return [pre, suf]
    getAll (map (Field "pairs":) ([Field "length"]:subArrays))
           `shouldReturn` [ BInteger 3
                          , BInteger 2, BBool True, BBool False
                          , BInteger 2, BBool False, BBool False
                          , BInteger 2, BBool True, BBool True
                          ]

  it "can declare a local struct" . runTest $ do
    void $ runBS [r|
contract qq {
  struct S {
    uint x;
    string s;
  }
  uint store_x;
  string store_s;
  constructor() {
    S memory str;
    str = S(0x777234, "Hello");
    store_x = str.x;
    store_s = str.s;
  }
}|]
    getFields ["store_x", "store_s"] `shouldReturn` [BInteger 0x777234, BString "Hello"]

  it "can cast contracts down" . runTest $ do
    void $ runBS [r|
contract X {}
contract Y {}

contract qq {
  X public x;
  constructor() public {
    Y y = Y(0x7733624642);
    x = X(y);
  }
}|]
    getFields ["x"] `shouldReturn` [BContract "X" 0x7733624642]

  it "can cast int to int" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x;
  constructor() public {
    uint y = 2347;
    x = uint(y);
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 2347]

  it "can <op>=" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x;
  constructor() public {
    x |= 0xf0f;
    x &= 0xff0;
    x ^= 0xff0;
    x += 0xa;
    x -= 0x3;
    x *= 0x10;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 0xf70]

  it "can construct two copies" . runTest $ do
    let qq = [r|
contract qq {
  uint x;
  constructor(uint _x) public {
    x = _x;
  }
}|]
    void $ runArgs "(1234)" qq
    void $ runArgs "(887324)" qq
    getFields ["x"] `shouldReturn` [BInteger 1234]
    getFields2 ["x"] `shouldReturn` [BInteger 887324]

  it "can call a remote function" . runTest $ do
    let qq = [r|
contract qq {
  qq x;
  uint num;
  constructor(address _x, uint _num) public {
    x = qq(_x);
    num = _num;
  }
  function a() public {
    num = x.b();
  }
  function b() public {
    return num + 1;
  }
}|]
    void $ runArgs "(0x0,99)" qq
    getFields ["x", "num"] `shouldReturn` [BContract "qq" 0x0, BInteger 99]

    void $ runArgs (T.pack $ printf "(0x%s,400)" $ show uploadAddress) qq
    getFields2 ["x", "num"] `shouldReturn` [BContract "qq" uploadAddress, BInteger 400]

    void $ call2 "a" "()" secondAddress
    getFields2 ["x", "num"] `shouldReturn` [BContract "qq" uploadAddress, BInteger 100]

  it "can locally return locals" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x;
  function f() returns (uint) {
    uint k = 85;
    return k;
  }

  constructor() public {
    x = f();
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 85]

  it "can locally return tuples" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x;
  string y;

  function f(uint k, string l) returns (uint, string) {
    return (k, l);
  }

  constructor() public {
    var (a, b) = f(444, "ok");
    x = a;
    y = b;
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 444, BString "ok"]

  it "can externally return locals" . runTest $ do
    void $ runCall "f" "()" [r|
contract qq {
  function f() returns (uint) {
    uint k = 99;
    return k;
  }
}|]

  it "can externally return tuples" . runTest $ do
    er <- runCall "f" "()" [r|
contract qq {
  function f() returns (uint, uint) {
    uint k = 0x0123456789abcdef0123456789abcdef;
    return (k, k);
  }
}|]
    let (kBS, "") = B16.decode "0123456789abcdef0123456789abcdef"
        zero = B.replicate 16 0
    er `shouldBe` defaultExecResults{ erNewContractAddress=Nothing
                                    , erReturnVal = Just (SB.toShort $ zero <> kBS <> zero <> kBS) }


  it "can assign to tuples" . runTest $ do
    liftIO $ pendingWith "tuple assignment"
    void $ runBS [r|
contract qq {
  uint x;
  uint y;
  constructor() public {
    (x, y) = (10, 17);
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 10, BInteger 17]

  it "can assign numeric to bytes32" . runTest $ do
    void $ runBS [r|
contract qq {
   bytes32 x = 0x5816f723b08edfdb4148b98e7be9d2e8000bab79b78e4e1615865eb92b1d7068;
}|]
    getFields ["x"] `shouldReturn`
      [BString "5816f723b08edfdb4148b98e7be9d2e8000bab79b78e4e1615865eb92b1d7068"]

  it "can convert bytes32toString" . runTest $ do
    void $ runBS [r|
contract Util {
  function bytes32ToString(bytes32 x) constant returns (string) {
      bytes memory bytesString = new bytes(32);
      uint charCount = 0;
      for (charCount = 0; charCount < 32; charCount++) {
        byte char = byte((uint(x) >> (32 - charCount - 1) * 8) & 0xFF);
        if (char == 0) {
          break;
        }
        bytesString[charCount] = char;
      }
      bytes memory bytesStringTrimmed = new bytes(charCount);
      for (uint j = 0; j < charCount; j++) {
          bytesStringTrimmed[j] = bytesString[j];
      }
      return string(bytesStringTrimmed);
  }
}

contract qq is Util {
  bytes32 bs = 0x32324f4354323000000000000000000000000000000000000000000000000000;
  string str;
  constructor() public {
    str = Util.bytes32ToString(bs);
  }
}|]
    getFields ["bs", "str"] `shouldReturn`
      [ BString "32324f4354323000000000000000000000000000000000000000000000000000"
      , BString "22OCT20"
      ]

  it "can read the length of new arrays" . runTest $ do
    void $ runBS [r|
contract qq {
  uint public len;
  constructor() public {
    uint[] memory xs = new uint[](2);
    len = xs.length;
  }
}|]
    getFields ["len"] `shouldReturn` [BInteger 2]

  it "can pass local arrays as arguments" . runTest $ do
    void $ runBS [r|
contract Validator {
  function isEmptyArray(bytes32[] memory _arr) pure internal returns (bool) {
    return _arr.length == 0;
  }
}

contract qq is Validator {
  bool public empty_is_empty;
  bool public nonempty_is_empty;
  uint public nonempty_length;
  constructor() public {
    bytes32[] memory empty;
    empty_is_empty = isEmptyArray(empty);

    bytes32[] memory nonempty = new bytes32[](1);
    nonempty_is_empty = isEmptyArray(nonempty);

  }
}
|]
    getFields ["empty_is_empty", "nonempty_is_empty"] `shouldReturn` [BBool True, BBool False]

  it "can resolve super" . runTest $ do
    let ctract = [r|
contract BaseContainer {
  function contains(uint x) internal returns (bool) {
    return x == 4;
  }
}

contract qq is BaseContainer {
  function contains(uint x) external returns (bool) {
    return super.contains(x);
  }
}|]
    runCall "contains" "(10)" ctract `shouldReturn` defaultCallResults{
        erReturnVal = Just . SB.toShort $ B.replicate 32 0}
    runCall "contains" "(4)" ctract `shouldReturn` defaultCallResults{
        erReturnVal = Just . SB.toShort $ B.replicate 31 0 <> B.singleton 1}

  it "selects the correct super with multiple parents" . runTest $ do
    runCall "value" "()" [r|
contract A {
    function value() public returns (uint) {
        return 0xa;
    }
}
contract B {
    function value() public returns (uint) {
        return 0xb;
    }
}
contract qq is A, B {
    function value() public returns (uint) {
        return super.value();
    }
}|] `shouldReturn` defaultCallResults{
        erReturnVal=Just . SB.toShort $ B.replicate 31 0 <> B.singleton 0xb}

  it "selects the correct super when parents are missing methods" . runTest $ do
    liftIO $ pendingWith "TODO: ADL in MRO"
    runCall "value" "()" [r|
contract A {
  function value() public returns (uint) {
    return 0xa;
  }
}
contract B {}
contract qq is A, B {
  function value() public returns (uint) {
    return super.value();
  }
}|] `shouldReturn` defaultCallResults{erReturnVal=Just "10"}


  it "can use named return values" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x;
  function f() public pure returns (uint _x) {
    _x = 887242634;
  }
  constructor() public {
    x = f();
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 887242634]

  it "can return and used named returns" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x;
  function f() public pure returns (uint _x) {
    if (true) {
      _x = 7272;
      return;
    }
    _x = 887;
  }
  constructor() public {
    x = f();
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 7272]

  it "can return early" . runTest $ do
    void $ runBS [r|
contract qq {
  unit x;
  constructor() {
    x = 343;
    return;
    x = 2401;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 343]
