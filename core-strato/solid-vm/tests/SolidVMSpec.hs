{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
import Control.Monad
import Control.Monad.Logger
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import qualified Data.Set as S
import HFlags
import Test.Hspec (hspec, Spec, describe, it)
import Test.Hspec.Expectations.Lifted

import Blockchain.Data.ExecResults
import Blockchain.Database.MerklePatricia as MP
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StateDB
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.VMContext
import qualified Blockchain.SolidVM as SVM
import Executable.EVMFlags() -- for HFlags

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

spec :: Spec
spec = do
  describe "Create" $ do
    it "should be able to run an empty contract" . runTest $ do
      runCreate "testdata/Empty.sol" `shouldReturn` defaultExecResults
      flushMemRawStorageDB
      getAllRawStorageKeyVals' uploadAddress `shouldReturn` []

    it "should be able to store a default int" . runTest $ do
      runCreate "testdata/DefaultInt.sol" `shouldReturn` defaultExecResults
      flushMemRawStorageDB
      getAllRawStorageKeyVals' uploadAddress `shouldNotReturn` []

    it "should be able to explicitly store an int" . runTest $ do
      runCreate "testdata/SetInt.sol" `shouldReturn` defaultExecResults
      flushMemRawStorageDB
      getAllRawStorageKeyVals' uploadAddress `shouldNotReturn` []
