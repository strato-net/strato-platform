{-# LANGUAGE OverloadedStrings #-}

module CaughtFailureForkSpec (spec) where

import BlockApps.Logging (runLogging)
import qualified Blockchain.Data.BlockHeader as Header
import Blockchain.EthConf (ethConf, networkConfig, networkID)
import Blockchain.Forks
import Blockchain.SolidVM.Simple hiding (name)
import Blockchain.Strato.Model.Address (Address)
import Blockchain.VMContext (ContextM, runMemContextM)
import Control.Lens
import Control.Monad (forM_)
import Control.Monad.Composable.Base (runEff)
import Control.Monad.IO.Class (liftIO)
import qualified Data.Text as T
import SolidVM.Model.Event (evName)
import SolidVM.Model.Value (Value (SIntegral))
import Test.Hspec

runContext :: ContextM a -> IO a
runContext = fmap fst . runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing

atHeight :: Integer -> SolidVMTxArgs -> SolidVMTxArgs
atHeight height = argsBlockData %~ (\header -> header {Header.number = height})

deploy :: Integer -> T.Text -> ContextM ()
deploy height source = do
  result <- create $ def & createNewAddress .~ 0x2000 & createContractName .~ "Probe"
    & createCode .~ Code source & createArgs %~ atHeight height
  liftIO $ erException result `shouldBe` Nothing

invoke :: Integer -> T.Text -> ContextM ExecResults
invoke height name = call $ def & callCodeAddress .~ 0x2000 & callFuncName .~ name
  & callArgs %~ atHeight height & callArgs . argsSender .~ (0x1000 :: Address)

returnedInteger :: ExecResults -> Maybe Integer
returnedInteger result = case erReturnVal result of
  Just (SIntegral n) -> Just n
  _ -> Nothing

spec :: Spec
spec = describe "caught-failure activation" $ do
  it "leaves public networks unscheduled and activates new networks at genesis" $ do
    caughtFailureForkBlock heliumNetworkID `shouldBe` forkNotScheduled
    caughtFailureForkBlock upquarkNetworkID `shouldBe` forkNotScheduled
    caughtFailureForkBlock 7381244120123405172 `shouldBe` 10000
    caughtFailureForkBlock 42 `shouldBe` 0

  -- Run in separate processes with STRATO_CONF for each network. Execution
  -- uses the configured height, not a test-only override of the fork decision.
  let activation = caughtFailureForkBlock (networkID $ networkConfig ethConf)
  it "switches exactly at the configured boundary" $ do
    isCaughtFailureForkActive (activation - 1) `shouldBe` False
    isCaughtFailureForkActive activation `shouldBe` True
    isCaughtFailureForkActive (activation + 1) `shouldBe` True

  let boundaries = [("before", activation - 1, False), ("at", activation, True), ("after", activation + 1, True)]
      historical = [("historical block 355722", 355722, False) | activation == forkNotScheduled]
  forM_ (filter (\(_, height, _) -> height >= 0) (historical ++ boundaries)) $ \(label, height, atomic) -> do
    it (label ++ ": replays approval followed by a caught failure") $ runContext $ do
      deploy height $ T.unlines
        [ "contract Token {"
        , "  mapping(address => mapping(address => uint)) public allowance;"
        , "  event Approval(uint amount);"
        , "  function approve(address spender, uint amount) { allowance[msg.sender][spender] = amount; emit Approval(amount); }"
        , "}"
        , "contract Probe { Token token; uint public cancelled;"
        , "  constructor() { token = new Token(); }"
        , "  function probe() returns (uint) {"
        , "    cancelled = 1;"
        , "    try { token.approve(address(0x1234), 666666666667000000); require(false, \"market expired\"); } catch { }"
        , "    return token.allowance(address(this), address(0x1234));"
        , "  }"
        , "}"
        ]
      result <- invoke height "probe"
      liftIO $ do
        erException result `shouldBe` Nothing
        returnedInteger result `shouldBe` Just (if atomic then 0 else 666666666667000000)
        map evName (erEvents result) `shouldBe` (if atomic then [] else ["Approval"])
      cancelled <- invoke height "cancelled"
      liftIO $ returnedInteger cancelled `shouldBe` Just 1

    it (label ++ ": gates failed-call events and sender restoration together") $ runContext $ do
      deploy height $ T.unlines
        [ "contract Target { uint public value; event Failed();"
        , "  function fail() { value = 7; emit Failed(); require(false, \"denied\"); }"
        , "}"
        , "contract Probe { Target target; constructor() { target = new Target(); }"
        , "  function probe() returns (bool) {"
        , "    try target.fail() { } catch { }"
        , "    return msg.sender == address(0x1000);"
        , "  }"
        , "  function value() returns (uint) { return target.value(); }"
        , "}"
        ]
      result <- invoke height "probe"
      liftIO $ do
        erException result `shouldBe` Nothing
        show (erReturnVal result) `shouldBe` (if atomic then "Just (SBool True)" else "Just (SBool False)")
        map evName (erEvents result) `shouldBe` (if atomic then [] else ["Failed"])
      value <- invoke height "value"
      liftIO $ returnedInteger value `shouldBe` Just 0

    it (label ++ ": keeps successful try effects and isolates a failed inner block") $ runContext $ do
      deploy height $ T.unlines
        [ "contract Probe { uint public value; event Kept(); event Inner();"
        , "  function probe() returns (uint) {"
        , "    try { value = 1; emit Kept(); try { value = 2; emit Inner(); require(false, \"inner\"); } catch { } } catch { }"
        , "    return value;"
        , "  }"
        , "}"
        ]
      result <- invoke height "probe"
      liftIO $ do
        erException result `shouldBe` Nothing
        returnedInteger result `shouldBe` Just (if atomic then 1 else 2)
        map evName (erEvents result) `shouldBe` (if atomic then ["Kept"] else ["Kept", "Inner"])

    it (label ++ ": preserves pending storage when a destruction is caught after activation") $ runContext $ do
      deploy height $ T.unlines
        [ "contract Doomed { uint public value;"
        , "  function set() { value = 7; }"
        , "  function fail() { selfdestruct(address(0x1000)); require(false, \"after destroy\"); }"
        , "}"
        , "contract Probe { Doomed target; constructor() { target = new Doomed(); }"
        , "  function seed() { target.set(); }"
        , "  function probe() returns (uint) { try target.fail() { } catch { } return target.value(); }"
        , "}"
        ]
      seeded <- invoke height "seed"
      liftIO $ erException seeded `shouldBe` Nothing
      result <- invoke height "probe"
      liftIO $ do
        erException result `shouldBe` Nothing
        returnedInteger result `shouldBe` Just (if atomic then 7 else 0)
