{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

--import           Control.Monad.IO.Class
--import qualified Data.ByteString.Char8              as C8
--import           Data.Maybe
--import qualified Data.Set                           as S
--import           Data.Word

--import qualified Test.Hspec                         as HS
--import           Test.Hspec.Expectations.Lifted

--import BlockApps.Logging
--import Blockchain.Blockstanbul.Authentication
--import Blockchain.Blockstanbul.BenchmarkLib
--import Blockchain.Data.Block
--import Blockchain.Data.DataDefs
--import Blockchain.Strato.Model.Address
--import Blockchain.Strato.Model.ChainMember
--import Blockchain.Strato.Model.Secp256k1
--import Blockchain.VMContext

import Blockchain.Data.VmTrace
import Blockchain.Strato.Model.Address (Address (..))
import Blockchain.VMOptions ()
import Control.Monad
import Executable.EVMFlags ()
import HFlags
import Test.Hspec (Spec, describe, hspec, it, shouldBe, shouldSatisfy)

--import qualified LabeledError

--it :: String -> ContextM () -> HS.SpecWith ()
--it qual act = HS.it qual . void . runNoLoggingT . runTestContextM $ act

main :: IO ()
main = do
  void $ $initHFlags "VMContext testing"
  hspec spec

--blk :: Block
--blk = makeBlock 1 1
--
--
--private :: PrivateKey
--private = fromMaybe (error "could not import private key") (importPrivateKey (LabeledError.b16Decode "private" $ C8.pack "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))
--
--
--instance HasVault ContextM where
--  sign bs = return $ signMsg private bs
--  getPub = error "called getPub, but this should never happen"
--  getShared _ = error "called getShared, but this should never happen"
--
--senderAddress :: Address
--senderAddress = fromPrivateKey private

spec :: Spec
spec = do
  describe "VMContext" $ pure ()
  callTraceSpec

-- Shorthands for driving the tracer the way the SolidVM hooks do.
enter :: Maybe VmTracer -> CallType -> Address -> Address -> Integer -> IO ()
enter mt ct from to gas = traceEnterFrame mt ct from to "C" "f" [] gas

theRoot :: [CallFrame] -> IO CallFrame
theRoot [r] = pure r
theRoot rs = fail $ "expected exactly one root frame, got " ++ show (length rs)

firstCall :: CallFrame -> IO CallFrame
firstCall f = case cfCalls f of
  (c : _) -> pure c
  [] -> fail "expected a child call"

callTraceSpec :: Spec
callTraceSpec = describe "VmTrace" $ do
  let a1 = Address 0x100
      a2 = Address 0x200

  it "builds a nested call tree with gas accounting" $ do
    t <- newVmTracer False
    let mt = Just t
    enter mt CTCall a1 a2 100
    enter mt CTCall a2 a1 90
    traceExitFrame mt 80 Nothing
    traceExitFrame mt 70 Nothing
    (roots, truncated) <- takeTraceRoots t
    truncated `shouldBe` False
    map cfType roots `shouldBe` [CTCall]
    root <- theRoot roots
    cfGasUsed root `shouldBe` 30
    map cfGasUsed (cfCalls root) `shouldBe` [10]
    cfFrom root `shouldBe` a1
    child <- firstCall root
    cfTo child `shouldBe` a1

  it "marks every unwinding frame with the error" $ do
    t <- newVmTracer False
    let mt = Just t
    enter mt CTCall a1 a2 100
    enter mt CTCall a2 a1 90
    traceExitFrame mt 80 (Just "boom")
    traceExitFrame mt 75 (Just "boom")
    ([root], _) <- takeTraceRoots t
    cfError root `shouldBe` Just "boom"
    map cfError (cfCalls root) `shouldBe` [Just "boom"]

  it "attaches the output to the most recently completed frame" $ do
    t <- newVmTracer False
    let mt = Just t
    enter mt CTCall a1 a2 100
    enter mt CTCall a2 a1 90
    traceExitFrame mt 80 Nothing
    traceSetLastOutput mt "7"
    traceExitFrame mt 70 Nothing
    traceSetLastOutput mt "42"
    ([root], _) <- takeTraceRoots t
    cfOutput root `shouldBe` Just "42"
    map cfOutput (cfCalls root) `shouldBe` [Just "7"]

  it "attaches logs to the open frame and drops logs outside any frame" $ do
    t <- newVmTracer False
    let mt = Just t
        lg = TraceLog a2 "Added" [("amount", "5")]
    traceAddLog mt lg -- no open frame: dropped
    enter mt CTCall a1 a2 100
    traceAddLog mt lg
    traceExitFrame mt 90 Nothing
    ([root], _) <- takeTraceRoots t
    cfLogs root `shouldBe` [lg]

  it "records statements only when enabled" $ do
    tOn <- newVmTracer True
    enter (Just tOn) CTCall a1 a2 100
    traceStatement (Just tOn) "A.sol" 1 1 1 99
    traceStatement (Just tOn) "A.sol" 2 1 1 98
    traceExitFrame (Just tOn) 90 Nothing
    ([rootOn], _) <- takeTraceRoots tOn
    length (cfStatements rootOn) `shouldBe` 2

    tOff <- newVmTracer False
    enter (Just tOff) CTCall a1 a2 100
    traceStatement (Just tOff) "A.sol" 1 1 1 99
    traceExitFrame (Just tOff) 90 Nothing
    ([rootOff], _) <- takeTraceRoots tOff
    cfStatements rootOff `shouldBe` []

  it "caps statement entries and reports truncation" $ do
    t <- newVmTracer True
    let mt = Just t
    enter mt CTCall a1 a2 1000000
    forM_ [1 .. 50001 :: Int] $ \i ->
      traceStatement mt "A.sol" i 1 1 (toInteger i)
    traceExitFrame mt 0 Nothing
    ([root], truncated) <- takeTraceRoots t
    truncated `shouldBe` True
    length (cfStatements root) `shouldBe` 50000

  it "drops the zero-work bookkeeping constructor frame" $ do
    t <- newVmTracer False
    let mt = Just t
    enter mt CTCall a1 a2 100
    enter mt CTCreate a2 a1 90 -- create''s empty bookkeeping frame
    traceExitFrame mt 90 Nothing
    enter mt CTCreate a2 a1 90 -- the real constructor
    traceStatement mt "A.sol" 1 1 2 89 -- statements disabled, so prove work via gas
    traceExitFrame mt 85 Nothing
    traceExitFrame mt 80 Nothing
    ([root], _) <- takeTraceRoots t
    map cfType (cfCalls root) `shouldBe` [CTCreate]
    map cfGasUsed (cfCalls root) `shouldBe` [5]

  it "does nothing when tracing is disabled" $ do
    enter Nothing CTCall a1 a2 100
    traceExitFrame Nothing 0 Nothing
    traceSetLastOutput Nothing "x"
    t <- newVmTracer False
    (roots, truncated) <- takeTraceRoots t
    roots `shouldBe` []
    truncated `shouldBe` False

  it "closes frames left open by an exception as unwound" $ do
    t <- newVmTracer False
    let mt = Just t
    enter mt CTCall a1 a2 100
    enter mt CTCall a2 a1 90
    (roots, _) <- takeTraceRoots t
    map cfError roots `shouldSatisfy` all (== Just "unwound")
    root <- theRoot roots
    map cfError (cfCalls root) `shouldBe` [Just "unwound"]
