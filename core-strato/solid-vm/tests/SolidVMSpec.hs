{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
import Control.Monad
import Control.Monad.Logger
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import qualified Data.Set as S
import HFlags
import Test.Hspec (hspec, Spec, describe, it, xit)
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
      metadata = error "TODO: metadata"

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

spec :: Spec
spec = do
  describe "Create" $ do
    xit "should be able to run an empty contract" . runTest $ do
      runCreate "testdata/Empty.sol" `shouldReturn` defaultExecResults
      checkStorage `shouldReturn` []

    xit "should be able to store a default int" . runTest $ do
      runCreate "testdata/DefaultInt.sol" `shouldReturn` defaultExecResults
      checkStorage `shouldNotReturn` []

    xit "should be able to explicitly store an int" . runTest $ do
      runCreate "testdata/SetInt.sol" `shouldReturn` defaultExecResults
      checkStorage `shouldNotReturn` []

    xit "should be able to store a string" . runTest $ do
      runCreate "testdata/SetString.sol" `shouldReturn` defaultExecResults
      checkStorage `shouldNotReturn` []

    it "should be able to store an array" . runTest $ do
      getSolidStorageKeyVal' uploadAddress [Field "nums", Field "length"]
        `shouldReturn` BDefault
      getSolidStorageKeyVal' uploadAddress [Field "nums", ArrayIndex 0]
        `shouldReturn` BDefault
      runCreate "testdata/ArrayPush.sol" `shouldReturn` defaultExecResults
      st <- checkStorage
      st `shouldSatisfy` (== 2) . length
      getSolidStorageKeyVal' uploadAddress [Field "nums", Field "length"]
        `shouldReturn` BInteger 1
      getSolidStorageKeyVal' uploadAddress [Field "nums", ArrayIndex 0]
        `shouldReturn` BInteger 3

    it "should be able to read an array" . runTest $ do
      checkStorage `shouldReturn` []
      runCreate "testdata/ArrayRead.sol" `shouldReturn` defaultExecResults
      st <- checkStorage
      st `shouldSatisfy` (== 5) . length
      mapM (getSolidStorageKeyVal' uploadAddress)
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
      mapM (getSolidStorageKeyVal' uploadAddress)
        [ [Field "us", MapIndex (INum 22)]
        , [Field "us", MapIndex (INum 999999)]
        , [Field "us", MapIndex (INum 10)]
        ] `shouldReturn` [BInteger 4, BInteger 21, BDefault]
