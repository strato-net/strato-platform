{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-unused-imports #-}
{-# OPTIONS_GHC -fno-warn-missing-fields #-}
module SolidVMSpec where

import Control.Monad
import Control.Monad.Logger
import Control.Monad.IO.Class
import qualified Data.ByteString as B
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
import SolidVM.Model.Storable

sender :: Address
sender = 0xdeadbeef

-- TODO: It's not clear what the difference between newAddress and uploadAddress,
-- aside from the fact that one is an argument to create and the other is generated
-- by SolidVM's create'
newAddress :: Address
newAddress = 0x0ddba11

uploadAddress :: Address
uploadAddress = getNewAddress_unsafe sender 0

devNull :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
devNull _ _ _ _ = return ()

runTest :: ContextM a -> IO ()
runTest f = void . flip runLoggingT devNull . runTestContextM $ do
  MP.initializeBlank =<< getStateDB
  setStateDBStateRoot MP.emptyTriePtr
  f

runFile :: FilePath -> ContextM ExecResults
runFile fp = runBS =<< liftIO (B.readFile fp)

runBS :: B.ByteString -> ContextM ExecResults
runBS bs = do
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
      origin = error "TODO: origin"
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = error "TODO: availableGas"
      txHash = error "TODO: txHash"
      chainId = error "TODO: chainId"
      metadata = Just $ M.fromList [("name",  "qq"), ("args", "()")]

  SVM.create isTest isHomestead suicides blockData callDepth sender origin
            value gasPrice availableGas newAddress code txHash chainId metadata

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

checkStorage :: ContextM [(MP.Key, B.ByteString)]
checkStorage = flushMemRawStorageDB >> getAllRawStorageKeyVals' uploadAddress

getAll :: [StoragePath] -> ContextM [BasicValue]
getAll = mapM (getSolidStorageKeyVal' uploadAddress)

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
      getAll [[Field "x"]] `shouldReturn` [BInteger 0xbe]


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
      st `shouldSatisfy` (== 2) . length
      getAll
        [ [Field "xs", MapIndex (INum 400)]
        , [Field "y"]
        , [Field "z"]
        ] `shouldReturn` [BInteger 343, BInteger 343, BDefault] -- z may also be 0

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
      getAll [[Field "x"]] `shouldReturn` [BDefault]

    it "can run complicated constructors" . runTest $ do
      runFile "testdata/Constructor.sol" `shouldReturn` defaultExecResults

    it "can exponentiate" . runTest $ do
      void $ runFile "testdata/Exp.sol"
      getAll [[Field "x"]] `shouldReturn` [BInteger 25]

    it "can use addresses as map keys" . runTest $ do
      void $ runFile "testdata/AddressMapping.sol"
      getAll [[Field "perms", MapIndex (IAddress 0xdeadbeef)]] `shouldReturn` [BInteger 0xfff]

    it "can hash correctly" . runTest $ do
      void $ runFile "testdata/Keccak256.sol"
      let input = map (\t -> [Field t]) ["buf1", "buf2", "hash1", "hash2"]
      getAll input `shouldReturn`
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
    it "can assign a struct" . runTest $ do
      void $ runFile "testdata/StructAssign.sol"
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
      getAll [ [Field "x"], [Field "y"] ] `shouldReturn` [BInteger 400000001, BInteger 400000000]

    it "can pre increment" . runTest $ do
      void $ runBS [r|
contract qq {
 uint x = 99;
 uint y = 17;
 constructor() {
   y = ++x;
  }
}|]
      getAll [ [Field "x"], [Field "y"]] `shouldReturn` [BInteger 100, BInteger 100]

    it "can post decrement" . runTest $ do
      void $ runBS [r|
contract qq {
  uint x = 10;
  uint y;
  constructor() {
    y = x--;

  }
}|]
      getAll [[Field "x"], [Field "y"]] `shouldReturn` [BInteger 9, BInteger 10]

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
