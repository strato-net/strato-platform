{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}

-- | Incremental block building must end at the state a verifier derives by
-- replaying the block from its parent in one run.
module BaggerSpec (spec) where

import Blockchain.Bagger
import qualified Blockchain.Bagger.BaggerState as B
import Blockchain.Bagger.Transactions
import Blockchain.Data.AddressStateDB (AddressState (..), blankAddressState)
import Blockchain.Data.BlockHeader (BlockHeader (BlockHeaderV2), getBlockGasLimit, stateRoot, timestamp)
import Blockchain.Data.ExecResults
import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.Data.TransactionDef (Transaction (..))
import Blockchain.Model.WrappedBlock (OutputBlock (..), OutputTx (..))
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256 (hash, zeroHash)
import Blockchain.Strato.Model.Validator
import Blockchain.VMContext (ContextM, evalMemContextM, withCurrentBlockHash)
import Blockchain.Wiring ()
import Control.Concurrent (threadDelay)
import Control.Monad (when)
import Control.Monad.Composable.Base (runEff, withNoLogger)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.StateDB (StateRoot)
import Control.Monad.IO.Class (liftIO)
import qualified Data.Map as M
import qualified Data.Set as S
import Data.Time.Clock.POSIX (posixSecondsToUTCTime, utcTimeToPOSIXSeconds)
import Test.Hspec
import UnliftIO.Directory (withCurrentDirectory)
import UnliftIO.Temporary (withSystemTempDirectory)

unfunded, funded, rewardSink, proposer :: Address
unfunded = 0x94cd
funded = 0xf00d
rewardSink = 0xdec1de
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

ok :: ExecResults
ok =
  ExecResults
    { erRemainingTxGas = 0,
      erRefund = 0,
      erReturnVal = Nothing,
      erTrace = [],
      erLogs = [],
      erEvents = [],
      erNewContractAddress = Nothing,
      erSuicideList = S.empty,
      erAction = Nothing,
      erException = Nothing,
      erPragmas = [],
      erNewValidators = [],
      erRemovedValidators = [],
      erStakeUpdates = M.empty
    }

setNonce :: Address -> Integer -> ContextM ()
setNonce a n = A.insert (A.Proxy @AddressState) a blankAddressState {addressStateNonce = n}

-- | vm-runner's mineTransactions in miniature: the block rewards record the
-- block's timestamp (as FeeRouter.payBlockRewards records quotedAt), then the
-- transactions run in order until one cannot pay.
mine :: MineTransactions ContextM
mine bd remGas txs _ payRewards = do
  when payRewards $ setNonce rewardSink (round . utcTimeToPOSIXSeconds $ timestamp bd)
  go [] txs
  where
    go ran [] = pure $ TxMiningResult Nothing (reverse ran) [] remGas Nothing
    go ran unran@(t : rest)
      | otSigner t == unfunded = pure $ TxMiningResult (Just $ TFInsufficientFunds 1 0 t) (reverse ran) unran remGas Nothing
      | otherwise = do
          setNonce (otSigner t) 1
          go (TxRunResult t (Right ok) 0 M.empty M.empty [] : ran) rest

-- | In memory, so nothing outlives the test. A rejected transaction's result
-- is still published to the vmevents stream, which lands in a scratch directory.
inContext :: ContextM a -> IO a
inContext f = withSystemTempDirectory "bagger-spec" $ \dir -> withCurrentDirectory dir $
  runEff . withNoLogger $ evalMemContextM (const (pure Nothing)) Nothing f

-- | Make a block at the blank state root the best block, and return that root.
startOnParent :: ContextM StateRoot
startOnParent = do
  parentRoot <- A.lookupWithDefault (A.Proxy @StateRoot) (Nothing :: Maybe Word256)
  let parent = (BlockHeaderV2 zeroHash "" "" "" "" 11 (posixSecondsToUTCTime 1000) "" [Validator proposer] [] [] Nothing []) {stateRoot = parentRoot}
  processNewBestBlock (hash "parent") parent []
  pure parentRoot

-- | Queue @t@ for the next build, as the mempool does once it has seen it.
promote :: OutputTx -> ContextM ()
promote t = updateBaggerState $ \st ->
  let c = B.miningCache st
   in st
        { B.seen = S.insert (otHash t) (B.seen st),
          B.miningCache = c {B.promotedTransactions = B.promotedTransactions c ++ [t]}
        }

-- | Replay @blk@ from @parentRoot@ in one run, as a verifier does.
replay :: StateRoot -> OutputBlock -> ContextM (Either String StateRoot)
replay parentRoot blk = do
  let hdr = obBlockData blk
  (_, res) <- withCurrentBlockHash (hash "verifier") $
    runFromStateRoot mine (getBlockGasLimit hdr) hdr {stateRoot = parentRoot} (obReceiptTransactions blk) proposer True
  pure $ either (Left . show) (\(sr, _, _) -> Right sr) res

spec :: Spec
spec = describe "Bagger.makeNewBlock" $ do
  it "builds a block that verifies after a run whose only transaction was rejected" $ do
    (built, replayed) <- inContext $ do
      parentRoot <- startOnParent
      promote (tx unfunded)
      _ <- makeNewBlock mine proposer
      -- The next transaction arrives in a later second, so its run restamps the block.
      liftIO $ threadDelay 1100000
      promote (tx funded)
      blk <- makeNewBlock mine proposer
      (,) blk <$> replay parentRoot blk
    map otSigner (obReceiptTransactions built) `shouldBe` [funded]
    replayed `shouldBe` Right (stateRoot (obBlockData built))

  it "rebuilds a candidate on the state its transactions left" $ do
    (parentRoot, first, rebuilt) <- inContext $ do
      parentRoot <- startOnParent
      promote (tx funded)
      first <- makeNewBlock mine proposer
      -- Nothing new is promoted, so the candidate comes from the cache alone.
      rebuilt <- makeNewBlock mine proposer
      pure (parentRoot, first, rebuilt)
    stateRoot (obBlockData first) `shouldNotBe` parentRoot
    obReceiptTransactions rebuilt `shouldBe` obReceiptTransactions first
    stateRoot (obBlockData rebuilt) `shouldBe` stateRoot (obBlockData first)
