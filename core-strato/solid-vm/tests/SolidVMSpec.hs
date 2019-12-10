{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# OPTIONS_GHC -fno-warn-unused-imports #-}
{-# OPTIONS_GHC -fno-warn-missing-fields #-}
module SolidVMSpec where

import Control.Concurrent
import Control.Concurrent.Async
import Control.DeepSeq
import Control.Exception
import Control.Monad
import Blockchain.Output
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import qualified Data.ByteString.Short as SB
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Base16 as B16
import Data.Coerce
import qualified Data.Map as M
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Text.Encoding
import Data.Time.Clock.POSIX
import HFlags
import Numeric
import Test.Hspec (hspec, Spec, describe, it, xit, pendingWith, shouldThrow, anyErrorCall, Selector)
import Test.Hspec.Expectations.Lifted
import Text.Printf
import Text.RawString.QQ

import Blockchain.Data.DataDefs (BlockData(..))
import Blockchain.Data.ExecResults
import Blockchain.Data.RLP
import Blockchain.Database.MerklePatricia as MP
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SolidStorageDB
import Blockchain.DB.StateDB
import Blockchain.Strato.Model.Action
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.SHA
import Blockchain.VMContext
import qualified Blockchain.SolidVM as SVM
import Blockchain.SolidVM.Exception
import Executable.EVMFlags() -- for HFlags
import Blockchain.VMOptions() -- for HFlags
import SolidVM.Model.Storable as MS

-- The newtype distinguishes uncaught SolidExceptions and
-- those that are returned in ExecResults
newtype HandledException = HE SolidException deriving (Show, Exception)

anyTODO :: Selector HandledException
anyTODO (HE TODO{}) = True
anyTODO _ = False

anyParseError :: Selector HandledException
anyParseError (HE ParseError{}) = True
anyParseError _ = False

anyUnknownFunc :: Selector HandledException
anyUnknownFunc (HE UnknownFunction{}) = True
anyUnknownFunc _ = False

sender :: Address
sender = 0xdeadbeef

origin :: Address
origin = 0x8341

uploadAddress :: Address
uploadAddress = getNewAddress_unsafe sender 0

secondAddress :: Address
secondAddress = getNewAddress_unsafe sender 1

recursiveAddr :: Address
recursiveAddr = getNewAddress_unsafe uploadAddress 0

devNull :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
devNull _ _ _ _ = return ()

runTest :: ContextM a -> IO ()
runTest f = do
  let timeout = 5000000
  result <- race (threadDelay timeout) $ runLoggingT (runTestContextM f)
  case result of
    Left{} -> expectationFailure $ printf "test case timed out after %ds" (timeout `div` 1000000)
    Right{} -> return ()

runFile :: FilePath -> ContextM ()
runFile fp = void $ runBS =<< liftIO (B.readFile fp)

runFileArgs :: T.Text -> FilePath -> ContextM ()
runFileArgs args fp = void $ runArgs args =<< liftIO (B.readFile fp)

runBS :: B.ByteString -> ContextM ()
runBS = void . runBS'

runBS' ::B.ByteString -> ContextM ExecResults
runBS' = runArgs "()"

rethrowEx :: ExecResults -> ContextM ()
rethrowEx ExecResults{erException=Just ex} = either (liftIO . throwIO . HE) (void . return) ex
rethrowEx _ = return ()


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
      txHash = SHA 0x776622233444
      chainId = Nothing
      metadata = Just $ M.fromList [("name",  "qq"), ("args", args)]

  newAddress <- getNewAddress sender
  er <- SVM.create isTest isHomestead suicides blockData callDepth sender origin
          value gasPrice availableGas newAddress code txHash chainId metadata
  rethrowEx er
  return er


runCall :: T.Text -> T.Text -> B.ByteString -> ContextM (Maybe SB.ShortByteString)
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
      txHash = SHA 0x234962
      chainId = Nothing
      createMetadata = Just $ M.fromList [("name",  "qq"), ("args", "()")]
      noValueTransfer = error "TODO: noValueTransfer"
      receiveAddress = error "TODO: receiveAddress"
      theData = error "TODO: theData"
      callMetadata = Just $ M.fromList [("funcName", funcName), ("args", callArgs)]
  newAddress <- getNewAddress sender
  er1 <- SVM.create isTest isHomestead suicides blockData callDepth sender origin
    value gasPrice availableGas newAddress code txHash chainId createMetadata
  rethrowEx er1
  er2 <- SVM.call isTest isHomestead noValueTransfer suicides blockData callDepth receiveAddress
    newAddress sender value gasPrice theData availableGas origin txHash chainId callMetadata
  rethrowEx er2
  return $ erReturnVal er2

call2 :: T.Text -> T.Text -> Address -> ContextM (Maybe SB.ShortByteString)
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
      txHash = SHA 0xddba11
      chainId = Nothing
      noValueTransfer = error "TODO: noValueTransfer"
      receiveAddress = error "TODO: receiveAddress"
      theData = error "TODO: theData"
      callMetadata = Just $ M.fromList [("funcName", funcName), ("args", callArgs)]
  er <- SVM.call isTest isHomestead noValueTransfer suicides blockData callDepth receiveAddress
    contractAddress sender value gasPrice theData availableGas origin txHash chainId callMetadata
  rethrowEx er
  return $ erReturnVal er



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
      runFileArgs [r|(["a","b","c"])|] "testdata/Ballot.sol"

  describe "Create" $ do
    it "should be able to run an empty contract" . runTest $ do
      runFile "testdata/Empty.sol"
      checkStorage `shouldReturn` []

    it "should be able to store a default int" . runTest $ do
      runFile "testdata/DefaultInt.sol"
      checkStorage `shouldNotReturn` []

    it "should be able to explicitly store an int" . runTest $ do
      runFile "testdata/SetInt.sol"
      checkStorage `shouldNotReturn` []

    it "can reduce a modulus" . runTest $ do
      runFile "testdata/Modulo.sol"
      getFields ["x"] `shouldReturn` [BInteger 0xbe]


    it "should be able to store a string" . runTest $ do
      runFile "testdata/SetString.sol"
      checkStorage `shouldNotReturn` []

    it "should be able to store an array" . runTest $ do
      getAll [ [Field "nums", Field "length"]
             , [Field "nums", ArrayIndex 0]
             ] `shouldReturn` [BDefault, BDefault]
      runFile "testdata/ArrayPush.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 2) . length
      getAll [ [Field "nums", Field "length"]
             , [Field "nums", ArrayIndex 0]
             ] `shouldReturn` [BInteger 1, BInteger 3]

    it "should be able to read an array" . runTest $ do
      checkStorage `shouldReturn` []
      runFile "testdata/ArrayRead.sol"
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
      liftIO $ pendingWith "deal with BMappingSentinel" --TODO- Jim
      runFile "testdata/MappingSet.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 3) . length
      getAll
        [ [Field "us"]
        , [Field "us", MapIndex (INum 22)]
        , [Field "us", MapIndex (INum 999999)]
        , [Field "us", MapIndex (INum 10)]
        ] `shouldReturn` [BMappingSentinel, BInteger 4, BInteger 21, BDefault]

    it "should be able to read from a map" . runTest $ do
      liftIO $ pendingWith "deal with BMappingSentinel" --TODO- Jim
      runFile "testdata/MappingRead.sol"
      st <- checkStorage
      -- The z assignment doesn't count, as at is set to the empty string
      st `shouldSatisfy` (== 4) . length
      getAll
        [ [Field "xs"]
        , [Field "xs", MapIndex (INum 400)]
        , [Field "y"]
        , [Field "z"]
        ] `shouldReturn` [BMappingSentinel, BInteger 343, BInteger 343, BInteger 0]

    it "should be able to set array length" . runTest $ do
      runFile "testdata/Length.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 1) . length
      getAll [[Field "xs", Field "length"]] `shouldReturn` [BInteger 24]

    it "should be able to read array length" . runTest $ do
      runFile "testdata/ReadLength.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 2) . length
      getAll [ [Field "xs", Field "length"]
             , [Field "y"]
             ] `shouldReturn` [BInteger 0x400, BInteger 0x400]

    it "can delete" . runTest $ do
      runFile "testdata/Delete.sol"
      getFields ["x"] `shouldReturn` [BDefault]

    it "can delete arrays" . runTest $ do
      runFile "testdata/DeleteArray.sol"
      getAll
        [ [Field "x", Field "length"]
        , [Field "x", ArrayIndex 0]
        , [Field "x", ArrayIndex 1]
        , [Field "x", ArrayIndex 2]
        ] `shouldReturn` replicate 4 BDefault

    it "can run complicated constructors" . runTest $ do
      runFile "testdata/Constructor.sol"

    it "can exponentiate" . runTest $ do
      runFile "testdata/Exp.sol"
      getFields ["x"] `shouldReturn` [BInteger 25]

    it "can use addresses as map keys" . runTest $ do
      runFile "testdata/AddressMapping.sol"
      getAll [[Field "perms", MapIndex (IAddress 0xdeadbeef)]] `shouldReturn` [BInteger 0xfff]

    it "can hash correctly" . runTest $ do
      runFile "testdata/Keccak256.sol"
      getFields ["buf1", "buf2", "hash1", "hash2"] `shouldReturn`
        [ BString (B.replicate 32 0xfe)
        , BString (BC.replicate 32 'x')
        , BString (fst $ B16.decode "59c3290d81fbdfe9ce1ffd3df2b61185e3089df0e3c49e0918e82a60acbed75a")
        , BString (fst $ B16.decode "5601c4475f2f6aa73d6a70a56f9c756f24d211a914cc7aff3fb80d2d8741c868")
        ]

    it "can hash multiple arguments" . runTest $ do
      liftIO $ pendingWith "TODO(blockapps.atlassian.net/browse/STRATO-1520)"
      runBS [r|
contract qq {
  bytes32 hsh;
  constructor() public {
    string username = "uname";
    string nodeIp = "enode://8814738274@127.0.0.1:30303";
    string chainId = "5601c4475f2f6aa73d6a70a56f9c756f24d211a914cc7aff3fb80d2d8741c868";
    hsh = keccak256(username, nodeIp, chainId);
  }
}
|]
      getFields ["hsh"] `shouldReturn` [BString $ word256ToBytes 0x4ebc701886e9562cf7998b9ab563c6d3ca5ad243b547f11f31ae1ae156b2ff97]


    it "can create a struct" . runTest $ do
      runBS [r|
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
}|]

      getAll [ [Field "x", Field "a"]
             , [Field "x", Field "b"]] `shouldReturn` [BInteger 900, BString "ok"]

    it "can directy initialize a struct" . runTest $ do
      runBS [r|
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
      runBS [r|
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
      runBS [r|
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
      runBS [r|
contract qq {
  uint x = 400000000;
  uint y;
  constructor() {
    y = x++;
  }
}|]
      getFields ["x", "y"] `shouldReturn` [BInteger 400000001, BInteger 400000000]

    it "can pre increment" . runTest $ do
      runBS [r|
contract qq {
 uint x = 99;
 uint y = 17;
 constructor() {
   y = ++x;
  }
}|]
      getFields ["x", "y"] `shouldReturn` [BInteger 100, BInteger 100]

    it "can post decrement" . runTest $ do
      runBS [r|
contract qq {
  uint x = 10;
  uint y;
  constructor() {
    y = x--;

  }
}|]
      getFields ["x", "y"] `shouldReturn` [BInteger 9, BInteger 10]

    it "can pre decrement" . runTest $ do
      runBS [r|
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
}|]

    it "can multiline require" . runTest $ do
      runBS [r|
contract qq {
  constructor() public {
    require(
      3 == 3,
      "Who is John Galt????"
    );
  }
}|]

    it "can index into maps with bool" . runTest $ do
      runBS [r|
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
      runBS [r|
contract X {}
contract qq {
  X x = X(0x999999);
}|]
      getAll [ [Field "x"] ] `shouldReturn` [BContract "X" 0x999999]

    it "should be able to return the time from the header" . runTest $ do
      runBS [r|
contract qq {
 uint ts1;
 uint ts2;
 constructor() {
   ts1 = block.timestamp;
   ts2 = now;
 }
}|]
      getFields ["ts1", "ts2"] `shouldReturn` [BInteger 0x4000, BInteger 0x4000]

    it "can parse one specific assembly block" . runTest $ do
      runBS [r|
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
    runBS [r|
contract qq {
  mapping(uint => mapping(uint => string)) xs;
  constructor() {
    xs[10][20] = "ok";
  }
}|]
    getAll [ [Field "xs", MapIndex (INum 10), MapIndex (INum 20)] ] `shouldReturn` [BString "ok"]

  it "can handle deeply nested mappings" . runTest $ do
    runBS [r|
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
    runBS [r|
contract qq {
  constructor() {
    bytes32[] mnames;
  }
}|]
    checkStorage `shouldReturn` []

  it "can array index with uninitialized numbers" . runTest $ do
    runBS [r|
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
    runBS [r|
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
    runBS [r|
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
    runBS [r|
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
    runBS [r|
contract qq {
  uint x = 20;
  constructor() {
    uint l = x;
    l += 10;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 20]

  it "should remember modifications to locals" . runTest $ do
    runBS [r|
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
    runBS [r|
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
    runBS [r|
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
    runBS [r|
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
    runBS [r|
contract qq {
  mapping(uint => uint) ns;
  bool found;
  constructor() {
    found = ns[0x0ddba11] != 0x0;
  }
}|]
    getFields ["found"] `shouldReturn` [BBool False]

  it "compares equal againts default" . runTest $ do
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS [r|
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
    runBS [r|
contract qq {
  address x;
  constructor() {
    x = msg.sender;
  }
}|]
    getFields ["x"] `shouldReturn` [BAddress sender]

  it "can read tx.origin" . runTest $ do
    runBS [r|
contract qq {
  address x;
  constructor() {
    x = tx.origin;
  }
}|]
    getFields ["x"] `shouldReturn` [BAddress origin]

  it "can infer types" . runTest $ do
    runBS [r|
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
    runBS [r|
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
    runBS [r|
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
    runBS [r|
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
    runBS [r|
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
    runBS [r|
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
    runBS [r|
contract qq {
  uint i;
  constructor() public {
    for (uint j = 0; j < 4; j++) {
      if (j % 2 == 0) {
        continue;
      }
      i++;
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 2]

  it "can break" . runTest $ do
    liftIO $ pendingWith "implement break"
    runBS [r|
contract qq {
  uint i = 25;
  constructor() public {
    for (uint j = 0; j < 100; j++) {
      if (j == 4) {
        break;
      }
      i++;
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 29]

  it "can return from a loop" . runTest $ do
    liftIO $ pendingWith "re-fix loops"
    runBS [r|
contract qq {
  uint i;
  constructor() public {
    for (uint j = 0; j < 5; j++) {
      i++;
      return;
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 1]


  it "can call functions on local contracts" . runTest $ do
    runBS [r|
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
    runBS [r|
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
    runBS [r|
contract Parent {
  uint public x = 3;
}

contract qq is Parent {
  uint y = 999;
}|]
    getFields ["x", "y"]` shouldReturn` [BInteger 3, BInteger 999]

  it "can call functions" . runTest $ do
    runCall "inc" "()" [r|
contract qq {
  uint x = 99;
  function inc() {
    x++;
  }
}|] `shouldReturn` Nothing
    getFields ["x"] `shouldReturn` [BInteger 100]

  it "can cast address to contract" . runTest $ do
    runBS [r|
contract X {}
contract qq {
  X x;
  constructor() public {
    x = X(0xdeadbeef);
  }
}|]
    getFields ["x"] `shouldReturn` [BContract "X" 0xdeadbeef]

  it "can call methods of superclasses" . runTest $ do
    runBS [r|
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
    runBS [r|
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
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS [r|
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
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS [r|
contract qq {
  address a = 0xdeadbeef;
}|]
    getFields ["a"] `shouldReturn` [BAddress 0xdeadbeef]

  it "can pass arrays by reference to functions" . runTest $ do
    runBS [r|
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
    runBS [r|
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
    runCall "addHead" "([10, 17])" [r|
contract qq {
  uint x;
  function addHead(uint[] ts) public {
    x += ts[0];
  }
}|] `shouldReturn` Nothing
    getFields ["x"] `shouldReturn` [BInteger 10]


  it "can store array literals" . runTest $ do
    runBS [r|
contract qq {
  uint[] xs = [10, 20, 90];
}|]
    getAll [ [Field "xs", Field "length"]
           , [Field "xs", ArrayIndex 0]
           , [Field "xs", ArrayIndex 1]
           , [Field "xs", ArrayIndex 2]
           ] `shouldReturn` [BInteger 3, BInteger 10, BInteger 20, BInteger 90]

  it "can accept nested arrays" . runTest $ do
    runBS [r|
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
    runBS [r|
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
    runBS [r|
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
    runBS [r|
contract qq {
  uint x;
  constructor() public {
    uint y = 2347;
    x = uint(y);
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 2347]

  it "can <op>=" . runTest $ do
    runBS [r|
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

    call2 "a" "()" secondAddress `shouldReturn` Nothing
    getFields2 ["x", "num"] `shouldReturn` [BContract "qq" uploadAddress, BInteger 100]

  it "can locally return locals" . runTest $ do
    runBS [r|
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
    runBS [r|
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
    runCall "f" "()" [r|
contract qq {
  function f() returns (uint) {
    uint k = 99;
    return k;
  }
}|] `shouldReturn` Just (SB.toShort $ B.replicate 31 0 <> B.singleton 99)

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
    er `shouldBe` Just (SB.toShort $ zero <> kBS <> zero <> kBS)


  it "can assign to tuples" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  uint y;
  constructor() public {
    (x, y) = (10, 17);
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 10, BInteger 17]

  it "can assign numeric to bytes32" . runTest $ do
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS [r|
contract qq {
   bytes32 x = 0x5816f723b08edfdb4148b98e7be9d2e8000bab79b78e4e1615865eb92b1d7068;
}|]
    getFields ["x"] `shouldReturn`
      [BString "5816f723b08edfdb4148b98e7be9d2e8000bab79b78e4e1615865eb92b1d7068"]

  it "can convert bytes32toString" . runTest $ do
    liftIO $ pendingWith "I'm not sure if this is correct"
    runBS [r|
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
    runBS [r|
contract qq {
  uint public len;
  constructor() public {
    uint[] memory xs = new uint[](2);
    len = xs.length;
  }
}|]
    getFields ["len"] `shouldReturn` [BInteger 2]

  it "can pass local arrays as arguments" . runTest $ do
    runBS [r|
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
    runCall "contains" "(10)" ctract `shouldReturn`
        Just (SB.toShort $ B.replicate 32 0)
    runCall "contains" "(4)" ctract `shouldReturn`
        Just (SB.toShort $ B.replicate 31 0 <> B.singleton 1)

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
}|] `shouldReturn` Just (SB.toShort $ B.replicate 31 0 <> B.singleton 0xb)

  it "selects the correct super when parents are missing methods" . runTest $ do
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
}|] `shouldReturn` Just (SB.toShort $ B.replicate 31 0 <> B.singleton 0xa)

  it "can determine super instance by function name" . runTest $ do
    runBS [r|
contract A {
  function a() public pure returns (uint) { return 0xaaaa;}
}
contract B {
  function b() public pure returns (uint) { return 0xbbbb;}
}
contract qq is A, B{
  uint x;
  uint y;
  constructor() public {
    x = super.a();
    y = super.b();
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 0xaaaa, BInteger 0xbbbb]


  it "can use named return values" . runTest $ do
    runBS [r|
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
    runBS [r|
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
    runBS [r|
contract qq {
  uint x;
  constructor() {
    x = 343;
    return;
    x = 2401;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 343]

  it "can initialize from constants" . runTest $ do
    runBS [r|
contract qq {
  uint constant c = 995;
  uint x = c;
}|]
    getFields ["c", "x"] `shouldReturn` [BDefault, BInteger 995]

  it "can assign from constants" . runTest $ do
    runBS [r|
contract qq {
  uint constant c = 2007;
  uint x;
  constructor() public {
    x = c;
  }
}|]
    getFields ["c", "x"] `shouldReturn` [BDefault, BInteger 2007]

  it "can read parent constants" . runTest $ do
    runBS [r|
contract Constants {
  uint constant VALIDATION_PASSED = 200;
}

contract qq is Constants {
  uint x;
  constructor() public {
    x = VALIDATION_PASSED;
  }
}|]

    getFields ["VALIDATION_PASSED", "x"] `shouldReturn` [BDefault, BInteger 200]

  it "can get the length of a string" . runTest $ do
    runBS [r|
contract qq {
  uint strlen;
  constructor() public {
    string s = "hello, world";
    strlen = s.length;
  }
}|]
    getFields ["strlen"] `shouldReturn` [BInteger 12]

  it "can get the length of bytes" . runTest $ do
    runBS [r|
contract qq {
  uint strlen;
  constructor() public {
    string s = "hello, world";
    strlen = bytes(s).length;
  }
}|]
    getFields ["strlen"] `shouldReturn` [BInteger 12]

  it "can call bytes32toString on literals" . runTest $ do
    runBS [r|
contract qq {
  string s;
  constructor() public {
    bytes32 x = "Will the real ";
    s = Util.bytes32ToString(x);
  }
}|]
    getFields ["s"] `shouldReturn` [BString "Will the real "]

  it "can return an address" . runTest $ do
    let want' = fst . B16.decode . BC.pack $ showHex sender ""
        want = B.replicate (32 - B.length want') 0x0 <> want'
    runCall "a" "()" [r|
contract qq {
  function a() public returns (address) {
    return msg.sender;
  }
}|] `shouldReturn` Just (SB.toShort want)

  it "can return an enum" . runTest $ do
    runCall "a" "()" [r|
contract qq {
  enum Letter { a, b, c }
  function a() public returns (Letter) {
    return Letter.c;
  }
}|] `shouldReturn` Just (SB.toShort $ B.replicate 31 0x0 <> B.singleton 2)

  it "will initialize contracts as such" . runTest $ do
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS [r|
contract X {}

contract qq {
  X x;
}|]
    getFields ["x"] `shouldReturn` [BContract "X" 0x0]

  it "will initialize fields of indirect constructions" . runTest $ do
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS [r|
contract X {
  uint i;
  string s;
}

contract qq {
  X x;
  constructor() {
    x = new X();
  }
}|]
    [BContract "X" x] <- getFields ["x"]
    getSolidStorageKeyVal' x (singleton "i") `shouldReturn` BInteger 0
    getSolidStorageKeyVal' x (singleton "s") `shouldReturn` BString ""

  it "will create a sentinel for mappings" . runTest $ do
    liftIO $ pendingWith "deal with BMappingSentinel" --TODO- Jim
    runBS [r|
contract qq {
  mapping(string => uint) assoc;
}|]
    getFields ["assoc"] `shouldReturn` [BMappingSentinel]


  it "can compare contracts to int literals" . runTest $ do
    runBS [r|
contract qq {
  bool eq;
  bool neq;
  constructor() public {
    qq q = qq(0);
    eq = q == 0x0;
    neq = q != 0x0;
  }
}|]
    getFields ["eq", "neq"] `shouldReturn` [BBool True, BBool False]

  it "can return a contract" . runTest $ do
    runCall "self" "()" [r|
contract qq {
  function self() public {
    return qq(this);
  }
}|] `shouldReturn` Just (SB.toShort . word256ToBytes $ coerce uploadAddress)

  it "merges actions for concurrent modifications" . runTest $ do
    xr <- runBS' [r|
contract Sub {
  uint x = 20;
  uint y = 40;

  function doubleY() public {
    y *= 2;
  }
}

contract qq {
  Sub s;

  constructor() public {
    s = new Sub();
    s.doubleY();
  }
}|]
    let diffs = fmap _actionDataStorageDiffs . _actionData <$> erAction xr
    diffs `shouldBe` Just (M.fromList
      [ (uploadAddress, ActionSolidVMDiff $ M.singleton ".s"
            (rlpSerialize $ rlpEncode $ BContract "Sub" recursiveAddr))
      , (recursiveAddr, ActionSolidVMDiff $ M.fromList
          [ (".x", rlpSerialize $ rlpEncode $ BInteger 20)
          , (".y", rlpSerialize $ rlpEncode $ BInteger 80)
          ]
        )
      ])

  it "stores enum numbers" . runTest $ do
    runBS [r|
contract qq {
    enum E {A, B, C, D}
    E c = E.C;
}|]
    getFields ["c"] `shouldReturn` [BEnumVal "E" "C" 2]

  it "can cast ints to enums" . runTest $ do
    runCall "f" "(1)" [r|
contract qq {
  enum E {A, B, C, D}
  E e;
  function f(E _e) {
    e = _e;
  }
}|] `shouldReturn` Nothing
    getFields ["e"] `shouldReturn` [BEnumVal "E" "B" 1]

  it "can compare ints to enums" . runTest $ do
    runCall "f" "(1)" [r|
contract qq {
  enum E {A, B, C, D}
  bool is_a;
  bool is_b;
  bool is_c;
  bool is_d;
  function f(E _e) {
    is_a = _e == E.A;
    is_b = _e == E.B;
    is_c = _e == E.C;
    is_d = _e == E.D;
  }
}|] `shouldReturn` Nothing
    getFields ["is_a", "is_b", "is_c", "is_d"] `shouldReturn`
      map BBool [False, True, False, False]

  it "can return textual bytes32" . runTest $ do
    runCall "txt" "()" [r|
contract qq {
  function txt() public returns (bytes32) {
    bytes32 ret = "Ticket ID already exists";
    return ret;
  }
}|] `shouldReturn` Just "Ticket ID already exists\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL"

  it "can return numeric bytes32" . runTest $ do
    runCall "num" "()" [r|
contract qq {
  function num() public returns (bytes32) {
    bytes32 ret = 0x5469636b657420494420616c7265616479206578697374730000000000000000;
    return ret;
  }
}|] `shouldReturn` Just "Ticket ID already exists\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL"

  it "can accept string arguments" . runTest $ do
    runCall "set" "(\"deadbeef00000000000000000000000000000000000000000000000000000000\")" [r|
contract qq {
  string st;
  function set(string _st) public {
    st = _st;
  }
}|] `shouldReturn` Nothing
    getFields ["st"] `shouldReturn` [BString "deadbeef00000000000000000000000000000000000000000000000000000000"]

  it "can accept bytes32 arguments" . runTest $ do
    runCall "set" "(\"deadbeef00000000000000000000000000000000000000000000000000000000\")" [r|
contract qq {
  bytes32 bs;
  function set(bytes32 _bs) public {
    bs = _bs;
  }
}|] `shouldReturn` Nothing
    getFields ["bs"] `shouldReturn` [BString "\xde\xad\xbe\xef"]

  it "should not compute remote arguments" $ runTest (do
    runCall "set" "(3 + block.timestamp)" [r|
contract qq {
  uint n;
  function set(uint _n) public {
    n = _n;
  }
}|]) `shouldThrow` anyParseError

  it "can call boolean arguments" . runTest $ do
    runCall "set" "(true,false)" [r|
contract qq {
  bool a;
  bool b;
  function set(bool _a, bool _b) public {
    a = _a;
    b = _b;
  }
}|] `shouldReturn` Nothing
    getFields ["a", "b"] `shouldReturn` [BBool True, BBool False]

  it "sets the origin correctly" . runTest $ do
    runBS [r|
contract X {
  function trampoline() returns (address) {
    return tx.origin;
  }
}

contract qq {
  address resolved_origin;
  constructor() {
    X x = new X();
    resolved_origin = x.trampoline();
  }
}|]
    getFields ["resolved_origin"] `shouldReturn` [BAddress origin]

  it "sets the sender correctly" . runTest $ do
    runBS [r|
contract X {
    function remoteSender() public returns (address) {
        return msg.sender;
    }
}

contract qq {
    address public direct_set;
    address public local_call;
    address public remote_call;

    function localSender() public returns (address) {
        return msg.sender;
    }
    constructor() payable public {
        direct_set = msg.sender;
        local_call = localSender();
        X x = new X();
        remote_call = x.remoteSender();
    }
}|]
    getFields ["direct_set", "local_call", "remote_call"] `shouldReturn`
      [BAddress sender, BAddress sender, BAddress uploadAddress]

  it "can set owner from management contract" . runTest $ do
    runBS [r|
contract X {
  address public owner;
  constructor() public {
    owner = msg.sender;
  }
}

contract qq {
  X x;
  constructor() public {
    x = new X();
  }
}|]
    -- qq should become the `owner` in X
    getFields ["x"] `shouldReturn` [BContract "X" recursiveAddr]
    getSolidStorageKeyVal' recursiveAddr (MS.singleton "owner") `shouldReturn`
      BAddress uploadAddress


  it "can cast from address" . runTest $ do
    runBS [r|
contract qq {
  address a;
  constructor() public {
    a = address(74);
  }
}|]
    getFields ["a"] `shouldReturn` [BAddress 74]

  it "can have a for loop with no fields" . runTest $ do
    liftIO $ pendingWith "re-fix loops"
    runBS [r|
contract qq {
  uint i;
  constructor() public {
    for (;;) {
      i += 3;
      if (i % 5 == 0) {
        break;
      }
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 15]

  it "can have a while loop" . runTest $ do
    liftIO $ pendingWith "re-fix loops"
    runBS [r|
contract qq {
  uint i;
  constructor() public {
    while (i < 8) {
      i++;
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 8]

  it "rejects modifiers" $ (runTest $ runBS [r| contract qq { modifier m() { _; } }|])
    `shouldThrow` anyTODO

  it "catches parse errors" $ (runTest $ runBS [r| contract { |]) `shouldThrow` anyParseError

  it "catches arg parse errors" $ (runTest $ do
    runCall "f" "(" [r|
contract qq {
  function f() public {}
}|]) `shouldThrow` anyParseError

  it "catches missing function errors" $
    (runTest $ runCall "f" "()" [r|contract qq {}|]) `shouldThrow` anyUnknownFunc

  it "can cast to int" . runTest $ do
    runBS [r|
contract qq {
  int z;
  constructor() public {
    z = int(123456);
  }
}|]
    getFields ["z"] `shouldReturn` [BInteger 123456]

  it "can create storage references to structs" . runTest $ do
    runBS [r|
contract qq {
  struct Nom {
    string id;
    uint nomType;
  }
  Nom[] noms;

  constructor() public {
    noms.push(Nom("239847", 7777));
    Nom storage n = noms[0];
    n.nomType = 13;
  }
}|]
    getAll [ [Field "noms", Field "length"]
           , [Field "noms", ArrayIndex 0, Field "id" ]
           , [Field "noms", ArrayIndex 0, Field "nomType" ]
           ] `shouldReturn` [BInteger 1, BString "239847", BInteger 13]

  it "can create memory copies of structs" . runTest $ do
    liftIO $ pendingWith "add the memory keyword" --TODO- Jim
    runBS [r|
contract qq {
  struct Nom {
    string id;
    uint nomType;
  }
  Nom[] noms;
  uint newType;

  constructor() public {
    noms.push(Nom("ok", 41));
    Nom memory n = noms[0];
    n.nomType = 92;
    newType = n.nomType;
  }
}|]
    getAll [ [Field "noms", Field "length"]
           , [Field "noms", ArrayIndex 0, Field "id"]
           , [Field "noms", ArrayIndex 0, Field "nomType"]
           , [Field "newType"]
           ] `shouldReturn` [BInteger 1, BString "ok", BInteger 41, BInteger 92]

  it "can multiply return" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  string y;
  function f() public returns (uint, string) {
    return (24, "hello");
  }
  constructor() public {
    (x, y) = f();
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 24, BString "hello"]

  it "can set local vars" . runTest $ do
    runBS [r|
contract Rest {
  enum Status {
    OK,
    NOT_FOUND
  }
}

contract qq is Rest {
  uint sum;
  struct Permit {
    uint p;
  }
  function f() public returns (uint, uint) {
    Permit memory perm;
    perm.p = 400;
    return (uint(Status.OK), perm.p);
  }
  constructor() public {
    var (a, b) = f();
    sum = a + b;
  }
}
|]
    getFields ["sum"] `shouldReturn` [BInteger 400]

  it "does stuff after an if" . runTest $ do
    liftIO $ pendingWith "loop control fix"
    runBS [r|
contract qq {
  uint x = 40;
  constructor() public {
    x++;
    if (true) {
    } else {
    }
    x++;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 42]

  it "can parse a singleton tuple" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  constructor() public {
    var (z) = 247;
    x = z;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 247]

  it "doesn't need var for variables in scope" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  uint y;
  constructor() public {
    (x, y) = (10, 20);
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 10, BInteger 20]

  it "can array convert for index" . runTest $ do
    liftIO $ pendingWith "TODO: creating references into strings"
    runBS [r|
contract qq {
  uint x;
  constructor() public {
    string txt = "hello, world";
    x = bytes(txt)[3];
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 0x6c]

  it "can increment array members" . runTest $ do
    runBS [r|
contract qq {
    uint[] xs = [1,1,3];
    constructor() public {
        xs[1]++;
    }
}|]
    getAll [ [Field "xs", Field "length"]
           , [Field "xs", ArrayIndex 0]
           , [Field "xs", ArrayIndex 1]
           , [Field "xs", ArrayIndex 2]
           ] `shouldReturn` [BInteger 3, BInteger 1, BInteger 2, BInteger 3]

  it "can reference characters" . runTest $ do
    liftIO $ pendingWith "TODO: something"
    runBS [r|
contract qq {
    string public xs = "ok";
    constructor() public {
      bytes(xs)[0] = 't';
      bytes(xs)[1] = 'y';
    }
}|]
    getFields ["xs"] `shouldReturn` [BString "ty"]

  it "can parse named arguments" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  constructor() public {
    x = f({y: 99});
  }

  function f(uint y) public returns (uint) {
    return y + 2;
  }
}
|]
    getFields ["x"] `shouldReturn` [BInteger 101]

  it "can call named argument constructors" . runTest $ do
    runBS [r|
contract X {
  uint public y;
  string public z;

  constructor(uint _y, string _z) public {
    y = _y;
    z = _z;
  }
}

contract qq {
  X public x;
  constructor() public {
    x = new X({_z: "ok", _y: 0x777777});
  }
}|]
    getFields ["x"] `shouldReturn` [BContract "X" recursiveAddr]
    mapM (getSolidStorageKeyVal' recursiveAddr) [MS.singleton "y", MS.singleton "z"]
      `shouldReturn` [BInteger 0x777777, BString "ok"]

  it "can cast a struct from named arguments" . runTest $ do
    runBS [r|
contract qq {
  struct S {
    uint x;
    uint y;
    string z;
  }
  S s;
  constructor() public {
    s = S({y: 87, z: "goodbye", x: 33});
  }
}|]
    getAll [ [Field "s", Field "x"]
           , [Field "s", Field "y"]
           , [Field "s", Field "z"]
           ] `shouldReturn` [BInteger 33, BInteger 87, BString "goodbye"]

  it "should be able to adjust arrayed structs" . runTest $ do
    runBS [r|
contract qq {
  struct X {
    uint x;
  }
  X[] xs;
  constructor() public {
    xs.push(X({x: 55}));
    xs[0].x *= 2;
  }
}|]
    getAll [ [Field "xs", ArrayIndex 0, Field "x" ]] `shouldReturn` [BInteger 110]

  it "can resolve variables for named arguments" . runTest $ do
    void $ runArgs "(\"stref\")" [r|
contract qq {
  struct X {
    string n;
  }
  X[] public names;
  constructor(string input_name) public {
    names.push(X({n: input_name}));
  }
}|]
    getAll [ [Field "names", ArrayIndex 0, Field "n"] ] `shouldReturn` [BString "stref"]

  it "can declare types for a tuple" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x;
  string y;
  function f() returns (uint, string) {
    return (0x42, "ok");
  }

  constructor() public {
    (uint _x, string _y) = f();
    x = _x;
    y = _y;
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 0x42, BString "ok"]

  it "can create new bytes" . runTest $ do
    void $ runBS [r|
contract qq {
  bytes xs;
  constructor() public {
    xs = new bytes(3);
  }
}|]
    getFields ["xs"] `shouldReturn` [BString "\x00\x00\x00"]

  it "overrides addressToAsciiString" . runTest $ do
    void $ runBS [r|
contract qq {
  string xs;
  constructor() public {
    xs = addressToAsciiString(this);
  }
}|]
    getFields ["xs"] `shouldReturn` [BString "e8279be14e9fe2ad2d8e52e42ca96fb33a813bbe"]

  it "can cast empty bytes32 to int" . runTest $ do
    void $ runBS [r|
contract qq {
  uint public x;
  constructor() public {
    x = uint(bytes(""));
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 0x0]

  it "can store nested structs" . runTest $ do
    void $ runBS [r|
contract qq {
  struct Inner {
    uint value;
  }
  struct Outer {
    Inner inner;
  }
  Outer public outer;
  constructor() public {
    Inner memory inner = Inner({value: 0x732});
    outer = Outer(inner);
  }
}
|]
    getAll [[Field "outer", Field "inner", Field "value"]] `shouldReturn` [BInteger 0x732]

  it "can not declare part of a tuple" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x;
  function ab() returns (uint, uint) {
    return (71, 833);
  }
  constructor() public {
    var (_, b) = ab();
    x = b;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 833]
