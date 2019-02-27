{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-unused-imports #-}
import Control.Monad
import Control.Monad.Logger
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.Map as M
import qualified Data.Set as S
import qualified Data.Text as T
import HFlags
import Test.Hspec (hspec, Spec, describe, it, xit, pendingWith)
import Test.Hspec.Expectations.Lifted

import Blockchain.Data.ExecResults
import Blockchain.Database.MerklePatricia as MP
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SolidStorageDB
import Blockchain.DB.StateDB
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.VMContext
import qualified Blockchain.SolidVM as SVM
import Executable.EVMFlags() -- for HFlags
import SolidVM.Model.Storable

main :: IO ()
main = do
  void $ $initHFlags "solid vm spec"
  hspec spec

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

runCreate :: FilePath -> ContextM ExecResults
runCreate fp = do
  code <- liftIO $ Code <$> B.readFile fp
  let isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      suicides = error "TODO: suicides"
      blockData = error "TODO: blockData"
      callDepth = 0
      origin = error "TODO: origin"
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = error "TODO: availableGas"
      txHash = error "TODO: txHash"
      chainId = error "TODO: chainId"
      metadata = Just $ M.singleton "name" "qq"

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
    xit "can be created" . runTest $ do
      liftIO $ pendingWith "Struct literal parsing, storage vs memory, multiline statements\
                           \ and address map keys need to be supported"
      runCreate "testdata/Ballot.sol" `shouldReturn` defaultExecResults

  describe "Create" $ do
    it "should be able to run an empty contract" . runTest $ do
      runCreate "testdata/Empty.sol" `shouldReturn` defaultExecResults
      checkStorage `shouldReturn` []

    it "should be able to store a default int" . runTest $ do
      runCreate "testdata/DefaultInt.sol" `shouldReturn` defaultExecResults
      checkStorage `shouldNotReturn` []

    it "should be able to explicitly store an int" . runTest $ do
      runCreate "testdata/SetInt.sol" `shouldReturn` defaultExecResults
      checkStorage `shouldNotReturn` []

    it "should be able to store a string" . runTest $ do
      runCreate "testdata/SetString.sol" `shouldReturn` defaultExecResults
      checkStorage `shouldNotReturn` []

    it "should be able to store an array" . runTest $ do
      getAll [ [Field "nums", Field "length"]
             , [Field "nums", ArrayIndex 0]
             ] `shouldReturn` [BDefault, BDefault]
      runCreate "testdata/ArrayPush.sol" `shouldReturn` defaultExecResults
      st <- checkStorage
      st `shouldSatisfy` (== 2) . length
      getAll [ [Field "nums", Field "length"]
             , [Field "nums", ArrayIndex 0]
             ] `shouldReturn` [BInteger 1, BInteger 3]

    it "should be able to read an array" . runTest $ do
      checkStorage `shouldReturn` []
      runCreate "testdata/ArrayRead.sol" `shouldReturn` defaultExecResults
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
      runCreate "testdata/MappingSet.sol" `shouldReturn` defaultExecResults
      st <- checkStorage
      st `shouldSatisfy` (== 2) . length
      getAll
        [ [Field "us", MapIndex (INum 22)]
        , [Field "us", MapIndex (INum 999999)]
        , [Field "us", MapIndex (INum 10)]
        ] `shouldReturn` [BInteger 4, BInteger 21, BDefault]

    it "should be able to read from a map" . runTest $ do
      runCreate "testdata/MappingRead.sol" `shouldReturn` defaultExecResults
      st <- checkStorage
      -- The z assignment doesn't count, as at is set to the empty string
      st `shouldSatisfy` (== 2) . length
      getAll
        [ [Field "xs", MapIndex (INum 400)]
        , [Field "y"]
        , [Field "z"]
        ] `shouldReturn` [BInteger 343, BInteger 343, BDefault] -- z may also be 0

    it "should be able to set array length" . runTest $ do
      runCreate "testdata/Length.sol" `shouldReturn` defaultExecResults
      st <- checkStorage
      st `shouldSatisfy` (== 1) . length
      getAll [[Field "xs", Field "length"]] `shouldReturn` [BInteger 24]

    it "should be able to read array length" . runTest $ do
      runCreate "testdata/ReadLength.sol" `shouldReturn` defaultExecResults
      st <- checkStorage
      st `shouldSatisfy` (== 2) . length
      getAll [ [Field "xs", Field "length"]
             , [Field "y"]
             ] `shouldReturn` [BInteger 0x400, BInteger 0x400]

    it "can delete" . runTest $ do
      runCreate "testdata/Delete.sol" `shouldReturn` defaultExecResults
      getAll [[Field "x"]] `shouldReturn` [BDefault]

    it "can run complicated constructors" . runTest $ do
      runCreate "testdata/Constructor.sol" `shouldReturn` defaultExecResults

    it "can exponentiate" . runTest $ do
      liftIO $ pendingWith "cannot parse `2 ** 5` as a binop"
      void $ runCreate "testdata/Exp.sol"
      getAll [[Field "x"]] `shouldReturn` [BInteger 25]

    it "can create a struct" . runTest $ do
      void $ runCreate "testdata/Struct.sol"
      getAll [ [Field "x", Field "a"]
             , [Field "x", Field "b"]] `shouldReturn` [BInteger 900, BString "ok"]

    it "can assign a struct" . runTest $ do
      liftIO $ pendingWith "cannot assign a struct literal"
      void $ runCreate "testdata/StructAssign.sol"
      getAll [ [Field "x", Field "a"]
             , [Field "x", Field "b"]] `shouldReturn` [BInteger 3, BInteger 4]

    it "can push a struct" . runTest $ do
      liftIO $ pendingWith "struct storage"
      void $ runCreate "testdata/StructPush.sol"
      getAll [ [Field "xs"]
             , [Field "xs", Field "length"]
             , [Field "xs", ArrayIndex 0, Field "a"]
             , [Field "xs", ArrayIndex 0, Field "b"]
             ] `shouldReturn` [BDefault, BInteger 1, BInteger 88, BInteger 73]

    it "can explicitly push a struct" . runTest $ do
      liftIO $ pendingWith "struct storage"
      void $ runCreate "testdata/StructPushSet.sol"
      getAll [ [Field "xs"]
             , [Field "xs", Field "length"]
             , [Field "xs", ArrayIndex 0, Field "a"]
             , [Field "xs", ArrayIndex 0, Field "b"]
             ] `shouldReturn` [BDefault, BInteger 1, BInteger 9000, BInteger 3000]

    it "can use addresses as map keys" . runTest $ do
      liftIO $ pendingWith "Address map"
      void $ runCreate "testdata/AddressMapping.sol"

    it "can reduce a modulus" . runTest $ do
      void $ runCreate "testdata/Modulo.sol"
      getAll [[Field "x"]] `shouldReturn` [BInteger 0xbe]

    it "can hash correctly" . runTest $ do
      liftIO $ pendingWith "keccak256 selection"
      void $ runCreate "testdata/Keccak256.sol"
      let input = map (\t -> [Field t]) ["buf1", "buf2", "hash1", "hash2"]
      getAll input `shouldReturn`
        [ BString (T.replicate 32 "\xfe")
        , BString (T.replicate 32 "x")
        , BString "59c3290d81fbdfe9ce1ffd3df2b61185e3089df0e3c49e0918e82a60acbed75a"
        , BString "5601c4475f2f6aa73d6a70a56f9c756f24d211a914cc7aff3fb80d2d8741c868"
        ]
