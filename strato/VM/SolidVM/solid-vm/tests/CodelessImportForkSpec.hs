{-# LANGUAGE OverloadedStrings #-}

module CodelessImportForkSpec (spec) where

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
import Data.Maybe (isNothing)
import qualified Data.Text as T
import Test.Hspec

runContext :: ContextM a -> IO a
runContext = fmap fst . runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing

atHeight :: Integer -> SolidVMTxArgs -> SolidVMTxArgs
atHeight height = argsBlockData %~ (\header -> header {Header.number = height})

-- Whether the creation succeeded.
deploy :: Integer -> Address -> T.Text -> T.Text -> ContextM Bool
deploy height address name source = do
  result <- create $ def & createNewAddress .~ address & createContractName .~ name
    & createCode .~ Code source & createArgs %~ atHeight height
  pure . isNothing $ erException result

invoke :: Integer -> Address -> T.Text -> ContextM ExecResults
invoke height address name = call $ def & callCodeAddress .~ address & callFuncName .~ name
  & callArgs %~ atHeight height & callArgs . argsSender .~ (0x1000 :: Address)

spec :: Spec
spec = describe "codeless-import activation" $ do
  it "schedules the public networks and activates new networks at genesis" $ do
    codelessImportForkBlock heliumNetworkID `shouldBe` 1250000
    codelessImportForkBlock upquarkNetworkID `shouldBe` 1100000
    codelessImportForkBlock 7381244120123405172 `shouldBe` 10000
    codelessImportForkBlock 42 `shouldBe` 0

  -- Run in separate processes with STRATO_CONF for each network.
  let activation = codelessImportForkBlock (networkID $ networkConfig ethConf)
      boundaries = [("before", activation - 1, False), ("at", activation, True), ("after", activation + 1, True)]
      dangling = "import <dead>; contract Probe {}"
  forM_ (filter (\(_, height, _) -> height >= 0) boundaries) $ \(label, height, rejected) -> do
    it (label ++ ": a creation importing an address without code") $ runContext $ do
      created <- deploy height 0x2000 "Probe" dangling
      liftIO $ created `shouldBe` not rejected

    it (label ++ ": a creation importing a destroyed contract") $ runContext $ do
      gone <- deploy height 0xdead "Gone" "contract Gone { constructor() { selfdestruct(msg.sender); } }"
      created <- deploy height 0x2000 "Probe" dangling
      liftIO $ (gone, created) `shouldBe` (True, not rejected)

    it (label ++ ": a creation importing a deployed contract") $ runContext $ do
      library <- deploy height 0xdead "Library" "contract Library {}"
      created <- deploy height 0x2000 "Probe" "import <dead>; contract Probe is Library {}"
      liftIO $ (library, created) `shouldBe` (True, True)

    it (label ++ ": a contract creating one from a source with such an import") $ runContext $ do
      created <- deploy height 0x2000 "Factory" $ T.unlines
        [ "contract Factory {"
        , "  constructor() { create(\"Made\", \"import <dead>; contract Made {}\"); }"
        , "}"
        ]
      liftIO $ created `shouldBe` not rejected

    it (label ++ ": a contract whose imported contract is destroyed afterwards") $ runContext $ do
      library <- deploy height 0xdead "Library" "contract Library { function kill() public { selfdestruct(msg.sender); } }"
      created <- deploy height 0x2000 "Probe" "import <dead>; contract Probe is Library { function probe() public returns (uint) { return 1; } }"
      destroyed <- invoke height 0xdead "kill"
      result <- invoke height 0x2000 "probe"
      liftIO $ do
        (library, created, erException destroyed) `shouldBe` (True, True, Nothing)
        -- Before activation the answer is whatever this node has cached.
        isNothing (erException result) `shouldBe` not rejected

  it "rejects a source that an earlier creation left in the cache" $ runContext $ do
    library <- deploy activation 0xdead "Library" "contract Library {}"
    first <- deploy activation 0x2000 "Probe" "import <dead>; import <beef>; contract Probe is Library {}"
    second <- deploy activation 0x3000 "Probe" "import <dead>; import <beef>; contract Probe is Library {}"
    liftIO $ (library, first, second) `shouldBe` (True, False, False)
