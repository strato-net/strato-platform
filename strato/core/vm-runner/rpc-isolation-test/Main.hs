{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Main (main) where

import BlockApps.Logging (runLogging)
import Blockchain.DB.CodeDB (getCode)
import Blockchain.Data.AddressStateDB (AddressState (..), blankAddressState)
import Blockchain.Data.BlockHeader (BlockHeader (..))
import Blockchain.JsonRpcCommand (runJsonRpcCommandSandboxed)
import Blockchain.Sequencer.CallSpec (CallSpec (..), TxCreateObject (..))
import Blockchain.Sequencer.Event (JsonRpcCommand (..), JsonRpcResponse (..))
import Blockchain.Sequencer.HexData (HexData (..))
import Blockchain.Sequencer.TxCallObject (TxCallObject (..))
import Blockchain.SolidVM.CodeCollectionDB (codeCollectionFromHash, codeCollectionFromSource)
import Blockchain.SolidVM.Exception (SolidException (..))
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.CodePtr (CodePtr (..))
import Blockchain.Strato.Model.Keccak256 (Keccak256, hash, zeroHash)
import Blockchain.TraceReplay (runJsonRpcCommandTraced)
import Blockchain.VMContext (ContextM, evalSandboxedContextM, runMemContextM)
import Blockchain.VMOptions ()
import Blockchain.Wiring ()
import Control.Exception (AsyncException (ThreadKilled), throw)
import Control.Monad (forM_, void)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Base (runEff)
import Control.Monad.IO.Class (liftIO)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Text.Encoding (decodeUtf8)
import Data.Time.Clock.POSIX (posixSecondsToUTCTime)
import Executable.EVMFlags ()
import HFlags
import System.Environment (lookupEnv)
import Test.Hspec

main :: IO ()
main = do
  void $ $initHFlags "RPC isolation regressions"
  fixture <- lookupEnv "RPC_ISOLATION_SOURCE_FIXTURE"
  hspec $ do
    spec
    forM_ fixture $ \path ->
      it "persists the supplied production source after simulation" $ do
        source <- B.readFile path
        runContext $ do
          h <- evalSandboxedContextM $ compile source
          getCode h >>= liftIO . (`shouldBe` Nothing)
          void $ compile source
          stored <- getCode h
          liftIO $ (stored == Just source) `shouldBe` True

runContext :: ContextM a -> IO a
runContext = fmap fst . runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing

compile :: B.ByteString -> ContextM Keccak256
compile = fmap fst . codeCollectionFromSource False True

header :: BlockHeader
header = BlockHeaderV2 zeroHash "" "" "" "" 1 (posixSecondsToUTCTime 1) "" [] [] [] Nothing []

missingCodeCall :: JsonRpcCommand
missingCodeCall = JRCCallV2 ownerCallSpec (Just header) "missing-code-owner"

ownerCallSpec :: CallSpec
ownerCallSpec = SpecCall $
  TxCallObject 0 (Just missingCodeAddress) "0x0" "0x0" "0x0" $ HexData $ B.pack [0x8d, 0xa5, 0xcb, 0x5b]

missingCodeAddress :: Address
missingCodeAddress = 0x2000

installMissingCodeAccount :: ContextM ()
installMissingCodeAccount = A.insert (A.Proxy @AddressState) missingCodeAddress $
  blankAddressState {addressStateCodeHash = SolidVMCode "Missing" (hash "missing-code-rpc-regression")}

isInternal :: SolidException -> Bool
isInternal InternalError{} = True
isInternal _ = False

spec :: Spec
spec = do
  describe "source persistence across compiler cache hits" $ do
    it "persists source after an actual RPC contract-creation simulation" $ runContext $ do
      let source = "contract RpcCreationSimulation { uint public value; }"
          creation = TxCreateObject 0 "0x2dc6c0" "0x0" "RpcCreationSimulation" (decodeUtf8 source) []
      response <- runJsonRpcCommandTraced $ JRCCallV2 (SpecCreate creation) (Just header) "simulate-creation"
      liftIO $ case response of
        Success requestId _ -> requestId `shouldBe` "simulate-creation"
        other -> expectationFailure $ "expected successful simulation, got " ++ show other
      getCode (hash source) >>= liftIO . (`shouldBe` Nothing)
      h <- compile source
      getCode h >>= liftIO . (`shouldBe` Just source)

    it "persists real deployment source after a discarded simulation" $ runContext $ do
      let source = "contract SimulationThenDeployment { uint public value; }"
      h <- evalSandboxedContextM $ compile source
      getCode h >>= liftIO . (`shouldBe` Nothing)
      realHash <- compile source
      liftIO $ realHash `shouldBe` h
      getCode h >>= liftIO . (`shouldBe` Just source)

    it "persists cached source independently in each context" $ do
      let source = "contract IndependentDeployment { uint public value; }"
      h <- runContext $ compile source
      result <- runContext $ compile source >>= getCode
      result `shouldBe` Just source
      h `shouldBe` hash source

    it "keeps repeated and nested simulations isolated" $ runContext $ do
      let source = "contract NestedSimulation { uint public value; }"
      h <- evalSandboxedContextM $ evalSandboxedContextM $ compile source
      void $ evalSandboxedContextM $ compile source
      getCode h >>= liftIO . (`shouldBe` Nothing)
      void $ compile source
      getCode h >>= liftIO . (`shouldBe` Just source)

    it "can reload deployed source after the compiled cache is evicted" $ runContext $ do
      let source = "contract ReloadAfterSimulation { uint public value; }"
      h <- evalSandboxedContextM $ compile source
      void $ compile source
      -- The compiled LRU has 128 entries; none of these writes may persist.
      evalSandboxedContextM $ forM_ [1 .. 129 :: Int] $ \n ->
        void $ compile $ BC.pack $ "contract Eviction" ++ show n ++ " { }"
      void $ codeCollectionFromHash False True h
      getCode h >>= liftIO . (`shouldBe` Just source)

  describe "RPC failure containment" $ do
    it "returns an error for missing source and executes the next RPC" $ runContext $ do
      installMissingCodeAccount
      accountBefore <- A.lookup (A.Proxy @AddressState) missingCodeAddress
      failed <- runJsonRpcCommandTraced missingCodeCall
      liftIO $ case failed of
        Error requestId message -> do
          requestId `shouldBe` "missing-code-owner"
          message `shouldContain` "internal error"
        other -> expectationFailure $ "expected an RPC error, got " ++ show other
      succeeded <- runJsonRpcCommandTraced $ JRCGetBalance missingCodeAddress "next-request" "latest"
      liftIO $ succeeded `shouldBe` Success "next-request" "0"
      accountAfter <- A.lookup (A.Proxy @AddressState) missingCodeAddress
      liftIO $ accountAfter `shouldBe` accountBefore

    it "does not change the VM's fatal classification of missing source" $
      runContext (installMissingCodeAccount >> runJsonRpcCommandSandboxed missingCodeCall)
        `shouldThrow` isInternal

    it "propagates asynchronous cancellation" $
      runContext (runJsonRpcCommandTraced $ JRCCallV2 ownerCallSpec (throw ThreadKilled) "cancelled")
        `shouldThrow` (== ThreadKilled)
