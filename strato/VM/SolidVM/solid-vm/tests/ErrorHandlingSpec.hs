{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE TypeApplications #-}

module ErrorHandlingSpec (spec) where

import BlockApps.Logging (runLogging)
import Blockchain.Data.AddressStateDB
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Data.RLP (RLPObject (..), rlpDecode)
import Blockchain.SolidVM.GasInfo
import Blockchain.SolidVM.SM
import "solid-vm" Blockchain.SolidVM.Simple
import Blockchain.VMContext (ContextM, runMemContextM)
import Control.Lens
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Base (runEff)
import Control.Monad.IO.Class (liftIO)
import qualified Data.Text as T
import SolidVM.Model.Value
import Test.Hspec
import qualified UnliftIO as E

runContext :: ContextM a -> IO a
runContext = fmap fst . runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing

runAction :: SM a -> ContextM (Either SolidException a)
runAction action = snd <$> runSM Nothing environment (GasInfo 100000 0 100000 "") action
  where
    environment = Environment 0 0 0 (def ^. argsBlockData) emptyHash Nothing Nothing False Nothing

deploy :: T.Text -> ContextM ExecResults
deploy source = create $ def & createNewAddress .~ 0x2000 & createContractName .~ "Probe" & createCode .~ Code source

invoke :: T.Text -> ContextM ExecResults
invoke name = call $ def & callCodeAddress .~ 0x2000 & callFuncName .~ name

isInternal :: SolidException -> Bool
isInternal InternalError{} = True
isInternal _ = False

spec :: Spec
spec = describe "VM failure classification" $ do
  it "returns contract errors as transaction failures" $ do
    result <- runContext $ runAction (E.throwIO (Require (Just "denied")) :: SM ())
    result `shouldBe` Left (Require (Just "denied"))

  it "rejects unsupported features without an internal error" $ do
    result <- runContext $ runAction (E.throwIO (UnsupportedFeature "user defined type assignment" "Amount") :: SM ())
    result `shouldBe` Left (UnsupportedFeature "user defined type assignment" "Amount")

  it "treats an internal call to the unimplemented RLP decoder as fatal" $
    runContext (runAction (liftIO $ E.evaluate (rlpDecode (RLPArray []) :: Value)))
      `shouldThrow` isInternal

  mapM_ (\(name, source) -> it name $ do
    result <- runContext $ deploy source
    case erException result of
      Just (Left TypeError{}) -> pure ()
      other -> expectationFailure $ "expected a declaration error, got " ++ show other)
    [ ("rejects inferred declarations without initializers", "contract Probe { constructor() { var x; } }")
    , ("rejects tuple declarations without initializers", "contract Probe { constructor() { (uint a, uint b); } }")
    ]

  it "continues to support inferred variables with initializers" $ runContext $ do
    result <- deploy "contract Probe { uint public value; constructor() { var x = 7; value = x; } }"
    liftIO $ erException result `shouldBe` Nothing
    value <- invoke "value"
    liftIO $ show (erReturnVal value) `shouldBe` "Just (SInteger 7)"

  it "fails only the transaction when a contract deletes a local variable" $ runContext $ do
    created <- deploy "contract Probe { function unsupported() { uint x = 7; delete x; } function healthy() returns (uint) { return 9; } }"
    liftIO $ erException created `shouldBe` Nothing
    failed <- invoke "unsupported"
    case erException failed of
      Just (Left UnsupportedFeature{}) -> pure ()
      other -> liftIO $ expectationFailure $ "expected UnsupportedFeature, got " ++ show other
    succeeded <- invoke "healthy"
    liftIO $ erException succeeded `shouldBe` Nothing
    liftIO $ show (erReturnVal succeeded) `shouldBe` "Just (SInteger 9)"

  it "allows contracts to catch an unsupported feature explicitly" $ runContext $ do
    created <- deploy "contract Probe { function probe() returns (uint) { try { uint x = 7; delete x; } catch UnsupportedFeature { return 5; } return 0; } }"
    liftIO $ erException created `shouldBe` Nothing
    caught <- invoke "probe"
    liftIO $ erException caught `shouldBe` Nothing
    liftIO $ show (erReturnVal caught) `shouldBe` "Just (SInteger 5)"

  it "uses the existing readable renderer for invalid argument values" $ runContext $ do
    created <- deploy "contract Probe { function probe(string text) returns (address) { return address(text); } }"
    liftIO $ erException created `shouldBe` Nothing
    failed <- call $ def & callCodeAddress .~ 0x2000 & callFuncName .~ "probe"
      & callArgs . argsArgs .~ ["\"this-is-not-a-valid-address-and-must-not-be-truncated\""]
    liftIO $ erException failed `shouldBe` Just (Left (TypeError "address cast" "\"this-is-not-a-valid-address-and-must-not-be-truncated\""))

  it "throws internal errors beyond the transaction runner" $
    runContext (runAction (E.throwIO (InternalError "broken invariant") :: SM ()))
      `shouldThrow` (== InternalError "broken invariant")

  it "throws unexpected host failures beyond the transaction runner" $
    runContext (runAction (E.throwIO (userError "host failure") :: SM ()))
      `shouldThrow` isInternal

  it "rolls back a rejected transaction and executes the next one" $ runContext $ do
    created <- deploy "contract Probe { uint public value; function fail() { value = 7; require(false, \"denied\"); } function succeed() { value = 9; } }"
    liftIO $ erException created `shouldBe` Nothing
    failed <- invoke "fail"
    liftIO $ erException failed `shouldBe` Just (Left (Require (Just "denied")))
    afterFailure <- invoke "value"
    liftIO $ show (erReturnVal afterFailure) `shouldBe` "Just (SInteger 0)"
    succeeded <- invoke "succeed"
    liftIO $ erException succeeded `shouldBe` Nothing
    afterSuccess <- invoke "value"
    liftIO $ show (erReturnVal afterSuccess) `shouldBe` "Just (SInteger 9)"

  mapM_ (\(label, source) -> it label $ do
    result <- runContext $ deploy source
    case erException result of
      Just (Left MissingType{}) -> pure ()
      other -> expectationFailure $ "expected MissingType, got " ++ show other)
    [ ("rejects missing parents as contract errors", "contract Probe is Missing {}")
    , ("rejects missing libraries as contract errors", "contract Probe { using Missing for uint; }")
    ]

  it "rejects cyclic inheritance as a contract error" $ do
    result <- runContext $ deploy "contract Probe is Other {} contract Other is Probe {}"
    case erException result of
      Just (Left TypeError{}) -> pure ()
      other -> expectationFailure $ "expected TypeError, got " ++ show other

  it "rejects excessive inheritance paths as a contract error" $ do
    let layer n = T.pack (show n)
        parents n = " is A" <> layer (n - 1) <> ", B" <> layer (n - 1) <> " {}"
        source = T.unlines $ ["contract A0 {} contract B0 {}"]
          ++ ["contract " <> name <> layer n <> parents n | n <- [1..9 :: Int], name <- ["A", "B"]]
          ++ ["contract Probe is A9 {}"]
    result <- runContext $ deploy source
    case erException result of
      Just (Left (TypeError "too many inheritance paths" _)) -> pure ()
      other -> expectationFailure $ "expected inheritance limit rejection, got " ++ show other

  it "still allows contracts to catch ordinary failures" $ runContext $ do
    result <- deploy $ T.unlines
      [ "contract Target { function fail() returns (uint) { require(false, \"denied\"); return 0; } }"
      , "contract Probe {"
      , " function typed() returns (uint) { try Target(address(0x3000)).fail() returns (uint result) { return result; } catch { return 99; } }"
      , " function legacy() returns (uint) { try { return 1 / 0; } catch DivideByZero { return 99; } }"
      , "}"
      ]
    liftIO $ erException result `shouldBe` Nothing
    target <- create $ def & createNewAddress .~ 0x3000 & createContractName .~ "Target"
      & createCode .~ Code "contract Target { function fail() returns (uint) { require(false, \"denied\"); return 0; } }"
    liftIO $ erException target `shouldBe` Nothing
    mapM_ (\name -> do
      caught <- invoke name
      liftIO $ erException caught `shouldBe` Nothing
      liftIO $ show (erReturnVal caught) `shouldBe` "Just (SInteger 99)") ["typed", "legacy"]

  it "preserves Solidity panic codes when catching transaction errors" $ runContext $ do
    let targetSource = "contract Target { error Denied(string reason, uint amount); function divide() returns (uint) { uint x = 0; return 1 / x; } function reverted() returns (uint) { revert(\"denied\"); return 0; } function custom() returns (uint) { revert Denied(\"denied\", 7); return 0; } }"
        entry name = "function " <> name <> "() returns (uint) { try Target(address(0x3000))." <> name <> "() returns (uint value) { return value; } catch Panic(uint code) { return code; } }"
    created <- deploy $ targetSource <> " contract Probe { " <> T.unwords (map entry ["divide", "reverted", "custom"]) <> " }"
    liftIO $ erException created `shouldBe` Nothing
    target <- create $ def & createNewAddress .~ 0x3000 & createContractName .~ "Target" & createCode .~ Code targetSource
    liftIO $ erException target `shouldBe` Nothing
    mapM_ (\(name, code) -> do
      result <- invoke name
      liftIO $ erException result `shouldBe` Nothing
      liftIO $ show (erReturnVal result) `shouldBe` "Just (SInteger " ++ show (code :: Int) ++ ")")
      [("divide", 12), ("reverted", 33), ("custom", 34)]

  mapM_ (\(name, body) -> it ("does not let " ++ name ++ " catch internal errors") $
    runContext (do
      created <- deploy $ T.unlines
        [ "contract Target { function value() returns (uint) { return 1; } }"
        , "contract Probe { function probe() returns (uint) { " <> body <> " } }"
        ]
      liftIO $ erException created `shouldBe` Nothing
      target <- create $ def & createNewAddress .~ 0x3000 & createContractName .~ "Target"
        & createCode .~ Code "contract Target { function value() returns (uint) { return 1; } }"
      liftIO $ erException target `shouldBe` Nothing
      A.adjustWithDefault_ (A.Proxy @AddressState) (0x3000 :: Address) $ \state ->
        pure state {addressStateCodeHash = SolidVMCode "Target" emptyHash}
      invoke "probe") `shouldThrow` isInternal)
    [ ("Solidity catches", "try Target(address(0x3000)).value() returns (uint result) { return result; } catch { return 99; }")
    , ("named SolidVM catches", "try { return Target(address(0x3000)).value(); } catch InternalError { return 99; }")
    , ("generic SolidVM catches", "try { return Target(address(0x3000)).value(); } catch { return 99; }")
    ]
