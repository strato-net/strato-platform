{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}

-- | The pool must refuse what no block can hold.
module BaggerSpec (spec) where

import Blockchain.Bagger
import Blockchain.Bagger.Transactions
import Blockchain.Data.BlockHeader (BlockHeader (BlockHeaderV2), stateRoot)
import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.Data.TransactionDef (Transaction (..))
import Blockchain.EthConf (ethConf, networkConfig)
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Model.WrappedBlock (OutputTx (..))
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256 (hash, zeroHash)
import Blockchain.Strato.Model.Validator
import Blockchain.VMContext (ContextM, evalMemContextM)
import Blockchain.Wiring ()
import Control.Monad.Composable.Base (runEff, withNoLogger)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.StateDB (StateRoot)
import Data.Time.Clock.POSIX (posixSecondsToUTCTime)
import Test.Hspec
import UnliftIO.Directory (withCurrentDirectory)
import UnliftIO.Temporary (withSystemTempDirectory)

unfunded, funded, proposer :: Address
unfunded = 0x94cd
funded = 0xf00d
proposer = 0x1

tx :: Address -> OutputTx
tx signer =
  OutputTx
    { otOrigin = TO.Direct,
      otHash = hash (if signer == unfunded then "unfunded" else "funded"),
      otSigner = signer,
      otBaseTx =
        MessageTX
          { nonce = 0,
            gasLimit = 21000,
            to = signer,
            funcName = "f",
            args = [],
            network = "test",
            chainId = Nothing,
            r = 0,
            s = 0,
            v = 0,
            txVersion = 0,
            attribution = ""
          }
    }

-- | @t@ asking for @g@ gas, signed for this chain.
withGas :: Integer -> OutputTx -> OutputTx
withGas g t = t {otBaseTx = (otBaseTx t) {gasLimit = g, chainId = Just . Conf.chainId $ networkConfig ethConf}}

-- | In memory, so nothing outlives the test; anything the context writes to
-- disk lands in a scratch directory.
inContext :: ContextM a -> IO a
inContext f = withSystemTempDirectory "bagger-spec" $ \dir -> withCurrentDirectory dir $
  runEff . withNoLogger $ evalMemContextM (const (pure Nothing)) Nothing f

-- | Make a block at the blank state root the best block.
startOnParent :: ContextM ()
startOnParent = do
  parentRoot <- A.lookupWithDefault (A.Proxy @StateRoot) (Nothing :: Maybe Word256)
  let parent = (BlockHeaderV2 zeroHash "" "" "" "" 11 (posixSecondsToUTCTime 1000) "" [Validator proposer] [] [] Nothing []) {stateRoot = parentRoot}
  processNewBestBlock (hash "parent") parent []

spec :: Spec
spec =
  describe "Bagger.isValidForPool" $
    it "refuses a gas limit no block can hold" $ do
      let cap = toInteger (maxBound :: Int)
          tooBig = withGas (cap + 1) (tx unfunded)
      (atCap, aboveCap) <- inContext $ do
        startOnParent
        (,) <$> isValidForPool (withGas cap (tx funded)) <*> isValidForPool tooBig
      atCap `shouldBe` Right ()
      aboveCap `shouldBe` Left (GasLimitTooHigh Validation Incoming cap (cap + 1) tooBig)
