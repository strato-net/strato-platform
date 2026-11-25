{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}

-- | Incremental block building must end at the state a verifier derives by
-- replaying the block from its parent in one run, and the pool must refuse
-- what no block can hold.
module BaggerSpec (spec) where

import Blockchain.Bagger
import qualified Blockchain.Bagger.BaggerState as B
import Blockchain.Bagger.Transactions
import Blockchain.DB.SolidStorageDB (putSolidStorageKeyVal')
import Blockchain.Data.AddressStateDB (AddressState (..), blankAddressState)
import Blockchain.Data.BlockHeader (BlockHeader (BlockHeaderV2), getBlockGasLimit, stateRoot, timestamp)
import Blockchain.Data.ExecResults
import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.Data.TransactionDef (Transaction (..))
import Blockchain.EthConf (ethConf, networkConfig)
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Model.WrappedBlock (OutputBlock (..), OutputTx (..))
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256 (hash, zeroHash)
import Blockchain.Strato.Model.Validator
import Blockchain.VMContext (ContextM, evalMemContextM, flushMemDBs, startFromStateRoot, withCurrentBlockHash)
import Blockchain.Wiring ()
import Control.Concurrent (threadDelay)
import Control.Monad (forM_, when)
import Control.Monad.Composable.Base (runEff, withNoLogger)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.StateDB (StateRoot)
import Control.Monad.IO.Class (liftIO)
import qualified Data.ByteString.Char8 as BC
import qualified Data.Map as M
import qualified Data.Set as S
import Data.Time.Clock.POSIX (posixSecondsToUTCTime, utcTimeToPOSIXSeconds)
import SolidVM.Model.Storable (BasicValue (..), StoragePath (..), StoragePathPiece (..))
import Test.Hspec
import UnliftIO.Directory (withCurrentDirectory)
import UnliftIO.Temporary (withSystemTempDirectory)

unfunded, funded, dust, rewardSink, proposer :: Address
unfunded = 0x94cd
funded = 0xf00d
dust = 0xd057
rewardSink = 0xdec1de
proposer = 0x1

tx :: Address -> OutputTx
tx signer =
  OutputTx
    { otOrigin = TO.Direct,
      otHash = hash (BC.pack $ "tx from " ++ show signer),
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

-- | @t@ asking for @g@ gas, signed for this chain.
withGas :: Integer -> OutputTx -> OutputTx
withGas g t = t {otBaseTx = (otBaseTx t) {gasLimit = g, chainId = Just . Conf.chainId $ networkConfig ethConf}}

-- | In memory, so nothing outlives the test; anything the context writes to
-- disk lands in a scratch directory.
inContext :: ContextM a -> IO a
inContext f = withSystemTempDirectory "bagger-spec" $ \dir -> withCurrentDirectory dir $
  runEff . withNoLogger $ evalMemContextM (const (pure Nothing)) Nothing f

-- | Make a block at the blank state root the best block, and return that root.
startOnParent :: ContextM StateRoot
startOnParent = startOnRoot =<< A.lookupWithDefault (A.Proxy @StateRoot) (Nothing :: Maybe Word256)

-- | Make a block at @parentRoot@ the best block, and return that root.
startOnRoot :: StateRoot -> ContextM StateRoot
startOnRoot parentRoot = do
  let parent = (BlockHeaderV2 zeroHash "" "" "" "" 11 (posixSecondsToUTCTime 1000) "" [Validator proposer] [] [] Nothing []) {stateRoot = parentRoot}
  processNewBestBlock (hash "parent") parent []
  pure parentRoot

-- | 'startOnParent' with each of @holders@ holding a cent of USDST, which any fee
-- route takes.
startFunded :: [Address] -> ContextM StateRoot
startFunded holders = startHolding [(a, legacyUsdFee) | a <- holders]

-- | 'startOnParent' with each address holding the given USDST.
startHolding :: [(Address, Integer)] -> ContextM StateRoot
startHolding holders = do
  -- the root is read under the block hash it was written under
  root <- withCurrentBlockHash (hash "funding") $ do
    startFromStateRoot =<< A.lookupWithDefault (A.Proxy @StateRoot) (Nothing :: Maybe Word256)
    forM_ holders $ \(a, amount) ->
      putSolidStorageKeyVal' 0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010 (StoragePath [Field "_balances", Index (BC.pack $ show a)]) (BInteger amount)
    flushMemDBs
    A.lookupWithDefault (A.Proxy @StateRoot) (Nothing :: Maybe Word256)
  startOnRoot root

-- | A transaction from @signer@, signed for this chain.
signed :: Address -> OutputTx
signed = withGas 21000 . tx

-- | @t@ at nonce @n@.
atNonce :: Integer -> OutputTx -> OutputTx
atNonce n t = t {otHash = hash (BC.pack $ "nonce " ++ show n), otBaseTx = (otBaseTx t) {nonce = n}}

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
spec = do
  describe "Bagger.makeNewBlock" $ do
    it "runs the rest of a batch after dropping a transaction that cannot pay" $ do
      (built, replayed) <- inContext $ do
        parentRoot <- startOnParent
        promote (tx unfunded)
        promote (tx funded)
        blk <- makeNewBlock mine proposer
        (,) blk <$> replay parentRoot blk
      map otSigner (obReceiptTransactions built) `shouldBe` [funded]
      replayed `shouldBe` Right (stateRoot (obBlockData built))

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

  describe "Bagger.runFromStateRoot" $
    it "rejects a run whose transaction has the wrong nonce" $ do
      let stale = atNonce 5 (signed funded)
          mineStale _ remGas txs _ _ = pure $ TxMiningResult (Just $ TFNonceMismatch 5 0 stale) [] txs remGas Nothing
      rejected <- inContext $ do
        root <- startOnParent
        let hdr = (BlockHeaderV2 zeroHash "" "" "" "" 11 (posixSecondsToUTCTime 1000) "" [Validator proposer] [] [] Nothing []) {stateRoot = root}
        (_, res) <- withCurrentBlockHash (hash "verifier") $
          runFromStateRoot mineStale (getBlockGasLimit hdr) hdr [stale] proposer True
        pure $ either (const True) (const False) res
      rejected `shouldBe` True

  describe "Bagger.isValidForPool" $ do
    it "refuses a gas limit no block can hold" $ do
      let cap = toInteger (maxBound :: Int)
          tooBig = withGas (cap + 1) (tx unfunded)
      (atCap, aboveCap) <- inContext $ do
        _ <- startFunded [funded]
        withBagger $ (,) <$> isValidForPool (withGas cap (tx funded)) <*> isValidForPool tooBig
      atCap `shouldBe` Right ()
      aboveCap `shouldBe` Left (GasLimitTooHigh Validation Incoming cap (cap + 1) tooBig)

    it "refuses a sender that holds nothing a fee can be paid with" $ do
      (broke, paying) <- inContext $ do
        _ <- startFunded [funded]
        withBagger $ (,) <$> isValidForPool (signed unfunded) <*> isValidForPool (signed funded)
      broke `shouldBe` Left (BalanceTooLow Validation Incoming legacyUsdFee 0 (signed unfunded))
      paying `shouldBe` Right ()

    it "holds at most maxTxsPerSender for one sender, who can still replace a queued nonce" $ do
      let most = toInteger maxTxsPerSender
      (next, replacing) <- inContext $ do
        _ <- startFunded [funded]
        updateBaggerState $ \st -> st {B.queued = M.singleton funded $ M.fromList [(n, atNonce n $ signed funded) | n <- [0 .. most - 1]]}
        withBagger $ (,) <$> isValidForPool (atNonce most $ signed funded) <*> isValidForPool (atNonce 5 $ signed funded)
      next `shouldBe` Left (SenderPoolFull Validation Incoming most (atNonce most $ signed funded))
      replacing `shouldBe` Right ()

    it "lets a full sender send its next executable nonce, which drains its queue" $ do
      let most = toInteger maxTxsPerSender
      gapFiller <- inContext $ do
        _ <- startFunded [funded]
        updateBaggerState $ \st -> st {B.queued = M.singleton funded $ M.fromList [(n, atNonce n $ signed funded) | n <- [1 .. most]]}
        withBagger $ isValidForPool (atNonce 0 $ signed funded)
      gapFiller `shouldBe` Right ()

  describe "Bagger.addTransactionsToMempool" $ do
    it "reports work only for a transaction the next block can take" $ do
      (broke, gapped, paying) <- inContext $ do
        _ <- startFunded [funded]
        (,,) <$> addTransactionsToMempool [signed unfunded] <*> addTransactionsToMempool [atNonce 3 $ signed funded] <*> addTransactionsToMempool [signed funded]
      broke `shouldBe` False
      gapped `shouldBe` False
      paying `shouldBe` True

    it "counts as work only a sender that clearly can pay" $ do
      (dusty, paying) <- inContext $ do
        _ <- startHolding [(funded, legacyUsdFee), (dust, 1)]
        (,) <$> addTransactionsToMempool [signed dust] <*> addTransactionsToMempool [signed funded]
      dusty `shouldBe` False
      paying `shouldBe` True

  describe "Bagger.canClearlyPayFee" $
    it "counts a sender paying in USDST under a STRATO quote only once it holds the router's purchase cap" $ do
      let twoCents = 0x2c
          heliumQuote = 4590660990727397 -- 0.00459 STRATO, about a cent on 2026-11-23
      (cent, cap, unquoted) <- inContext $ do
        _ <- startHolding [(funded, legacyUsdFee), (twoCents, 2 * legacyUsdFee)]
        withBagger $ (,,) <$> canClearlyPayFee heliumQuote funded <*> canClearlyPayFee heliumQuote twoCents <*> canClearlyPayFee 0 funded
      cent `shouldBe` False
      cap `shouldBe` True
      unquoted `shouldBe` True

  describe "Bagger.hasPendingWork" $
    it "sees payable work left pending, and none from a sender that cannot clearly pay" $ do
      (dustOnly, withPaying) <- inContext $ do
        _ <- startHolding [(funded, legacyUsdFee), (dust, 1)]
        _ <- addTransactionsToMempool [signed dust]
        a <- hasPendingWork
        _ <- addTransactionsToMempool [signed funded]
        (,) a <$> hasPendingWork
      dustOnly `shouldBe` False
      withPaying `shouldBe` True

  describe "Bagger.splitHoldingNothing" $
    it "holds back only the transactions of senders that hold nothing" $ do
      (ready, deferred) <- inContext $ do
        _ <- startFunded [funded]
        splitHoldingNothing [signed funded, signed unfunded]
      map otSigner ready `shouldBe` [funded]
      map otSigner deferred `shouldBe` [unfunded]

