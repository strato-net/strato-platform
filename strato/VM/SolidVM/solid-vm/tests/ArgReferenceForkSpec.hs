{-# LANGUAGE OverloadedStrings #-}

module ArgReferenceForkSpec (spec) where

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

-- A logic contract behind a forwarding fallback, as the platform Proxy does.
-- take() has no zero check: it relies on its bound.
forwarded :: [T.Text]
forwarded =
  [ "contract Logic { uint public secret; uint public paid;"
  , "  function init() public { secret = 777; }"
  , "  function take(uint amount) public { require(amount <= 0, \"over\"); uint copy = amount; paid = copy; }"
  , "}"
  , "contract Forwarder { address logic; constructor(address l) { logic = l; }"
  , "  fallback(variadic args) external returns (variadic) { return logic.delegatecall(msg.sig, args); }"
  , "}"
  ]

spec :: Spec
spec = describe "argument-reference activation" $ do
  it "schedules the public networks and activates new networks at genesis" $ do
    argReferenceForkBlock heliumNetworkID `shouldBe` 1217000
    argReferenceForkBlock upquarkNetworkID `shouldBe` 1100000
    argReferenceForkBlock 7381244120123405172 `shouldBe` 10000
    argReferenceForkBlock 42 `shouldBe` 0

  -- Run in separate processes with STRATO_CONF for each network.
  let activation = argReferenceForkBlock (networkID $ networkConfig ethConf)
  it "switches exactly at the configured boundary" $ do
    isArgReferenceForkActive (activation - 1) `shouldBe` False
    isArgReferenceForkActive activation `shouldBe` True
    isArgReferenceForkActive (activation + 1) `shouldBe` True

  let boundaries = [("before", activation - 1, False), ("at", activation, True), ("after", activation + 1, True)]
  forM_ (filter (\(_, height, _) -> height >= 0) boundaries) $ \(label, height, resolved) -> do
    it (label ++ ": a reference nested in a variadic is read from the caller") $ runContext $ do
      deploy height . T.unlines $ forwarded ++
        [ "contract Probe { uint secret; address target;"
        , "  constructor() { target = address(new Forwarder(address(new Logic()))); target.call(\"init\"); }"
        , "  function hop(variadic x) internal { target.call(\"take\", msg.data); }"
        , "  function probe() returns (uint) { hop(secret); return target.call(\"paid\"); }"
        , "}"
        ]
      result <- invoke height "probe"
      liftIO $ do
        erException result `shouldBe` Nothing
        returnedInteger result `shouldBe` Just (if resolved then 0 else 777)

    it (label ++ ": a value-typed reference passed to a delegatecall is read at the call") $ runContext $ do
      deploy height $ T.unlines
        [ "contract Logic { uint slot; uint out;"
        , "  function run(uint amount) public { slot = 5; uint copy = amount; out = copy; }"
        , "}"
        , "contract Probe { uint slot; uint out; address logic;"
        , "  constructor() { logic = address(new Logic()); }"
        , "  function probe() returns (uint) { logic.delegatecall(\"run\", slot); return out; }"
        , "}"
        ]
      result <- invoke height "probe"
      liftIO $ do
        erException result `shouldBe` Nothing
        returnedInteger result `shouldBe` Just (if resolved then 0 else 5)
