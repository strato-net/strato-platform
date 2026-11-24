{-# LANGUAGE OverloadedStrings #-}

module EthCallSpec (spec) where

import BlockApps.Logging (runLogging)
import Blockchain.JsonRpcCommand (ethCallEx)
import Blockchain.SolidVM.Simple
import Blockchain.VMContext (ContextM, runMemContextM)
import Control.Lens
import Control.Monad.Composable.Base (runEff)
import Control.Monad.IO.Class (liftIO)
import qualified Data.ByteString as B
import qualified Data.Text as T
import Data.Word (Word8)
import Test.Hspec

runContext :: ContextM a -> IO a
runContext = fmap fst . runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing

-- A selector followed by the key 0xabc as one ABI word.
withKey :: [Word8] -> B.ByteString
withKey selector = B.pack selector <> B.replicate 30 0 <> B.pack [0x0a, 0xbc]

seven :: B.ByteString
seven = B.replicate 31 0 <> B.singleton 7

spec :: Spec
spec = describe "eth_call" $
  it "reads an address-keyed public mapping through its getter, as through a function" $ runContext $ do
    deployed <- create $ def & createNewAddress .~ 0x2000 & createContractName .~ "Probe"
      & createCode .~ Code (T.unlines
          [ "contract Probe { mapping(address => uint) public m;"
          , "  constructor() { m[address(0xabc)] = 7; }"
          , "  function get(address a) public view returns (uint) { return m[a]; }"
          , "}"
          ])
    liftIO $ erException deployed `shouldBe` Nothing
    let header = (def :: SolidVMTxArgs) ^. argsBlockData
    viaGetter <- ethCallEx header (Gas 600000) 0x1000 0x2000 (withKey [0x97, 0x68, 0x28, 0x84]) -- m(address)
    viaFunction <- ethCallEx header (Gas 600000) 0x1000 0x2000 (withKey [0xc2, 0xbc, 0x2e, 0xfc]) -- get(address)
    liftIO $ do
      fst viaFunction `shouldBe` Right seven
      fst viaGetter `shouldBe` Right seven
