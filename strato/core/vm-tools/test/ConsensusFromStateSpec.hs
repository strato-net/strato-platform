{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

-- | The header's validator-set and stake-weight changes derived from contract
-- state, and the block builder's rule for a reward run that ran nothing.
module ConsensusFromStateSpec (spec) where

import Blockchain.Bagger (MineTransactions, TxMiningResult (..), discardsRewardRun, getBaggerState, makeNewBlock, processNewBestBlock, putBaggerState)
import qualified Blockchain.Bagger.BaggerState as B
import Blockchain.Bagger.Transactions (TransactionFailureCause (..), TxRunResult (..), blockConsensusDeltas, consensusDeltasFromHeld, consensusOutcome, governanceValidatorsAndStakes, shadowMismatch)
import Blockchain.DB.SolidStorageDB (putSolidStorageKeyVal')
import Blockchain.Data.BlockHeader
import Blockchain.Data.ExecResults (ExecResults (..), solidvmErrorResults)
import Blockchain.Data.RLP (rlpDecode, rlpDeserialize)
import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.Model.WrappedBlock (OutputBlock (..), OutputTx (..))
import Blockchain.Strato.Model.Address (Address (..))
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256 (hash)
import Blockchain.Strato.Model.StateRoot (StateRoot)
import Blockchain.Strato.Model.Validator
import Blockchain.VMContext (ContextM, evalMemContextM, flushMemDBs, startFromStateRoot, withCurrentBlockHash)
import Control.Monad (forM_)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Base (runEff, withNoLogger)
import Control.Monad.IO.Class (liftIO)
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.Map as M
import qualified Data.Set as S
import Data.Maybe (isJust)
import Data.Time.Clock.POSIX (posixSecondsToUTCTime)
import SolidVM.Model.Delta (applyStakeDelta, fromDelta, toDelta)
import SolidVM.Model.Storable (BasicValue (..), StoragePath (..), StoragePathPiece (..))
import Test.Hspec
import Test.QuickCheck

a, b, c, d :: Validator
a = Validator 0xa
b = Validator 0xb
c = Validator 0xc
d = Validator 0xd

-- | What the consensus layer does with a header's changes (applyValidatorChanges).
applied :: S.Set Validator -> M.Map Validator Integer -> [(Validator, Integer)] -> (S.Set Validator, M.Map Validator Integer)
applied inForce stakes held =
  let (vd, sd) = consensusDeltasFromHeld inForce stakes held
      (added, removed) = fromDelta vd
   in ((inForce `S.union` S.fromList added) S.\\ S.fromList removed, applyStakeDelta removed sd stakes)

-- | Governance's validators and weights, written where the node reads them
-- ('governanceValidatorsAndStakes').
writeGovernance :: [(Validator, Integer)] -> ContextM ()
writeGovernance held = do
  put [Field "validators", Field "length"] (BInteger . fromIntegral $ length held)
  forM_ (zip [0 :: Int ..] held) $ \(i, (Validator v, w)) -> do
    put [Field "validators", Index (BC.pack $ show i)] (BAddress v)
    put [Field "validatorStake", Index (BC.pack $ show v)] (BInteger w)
  where
    put :: [StoragePathPiece] -> BasicValue -> ContextM ()
    put path = putSolidStorageKeyVal' (Address 0x100) (StoragePath path)

-- | A transaction as the builder holds it. Nothing here executes it.
transfer :: OutputTx
transfer =
  OutputTx
    { otOrigin = TO.API,
      otHash = hash "transfer",
      otSigner = Address 0x9,
      otBaseTx = case B16.decode "f86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83" of
        Right bytes -> rlpDecode $ rlpDeserialize bytes
        Left err -> error err
    }

-- | Stands in for the VM: every transaction runs, and the run leaves b's weight
-- at 300 in governance.
runRaisingB :: MineTransactions ContextM
runRaisingB _ gas txs _ _ = do
  writeGovernance [(a, 100), (b, 300)]
  pure $ TxMiningResult Nothing [TxRunResult tx (Right ran) 0 M.empty M.empty [] | tx <- txs] [] gas Nothing
  where
    ran = (solidvmErrorResults undefined) {erException = Nothing}

-- | A run that changes state the same way and then fails with nothing run.
runFailingWithNothingRun :: MineTransactions ContextM
runFailingWithNothingRun _ gas txs _ _ = do
  writeGovernance [(a, 100), (b, 300)]
  pure $ TxMiningResult (Just $ TFBlockGasLimitExceeded 1 0 transfer) [] txs gas Nothing

currentRoot :: ContextM StateRoot
currentRoot = A.lookupWithDefault (A.Proxy @StateRoot) (Nothing :: Maybe Word256)

-- | The builder on a parent block (the first with staking active in the test
-- configuration, so its child's changes are read from state) whose state holds
-- a and b at 100 each, with one transaction promoted. The body gets the
-- parent's state root.
onParent :: (StateRoot -> ContextM r) -> IO r
onParent body = runEff . withNoLogger . evalMemContextM (const $ pure Nothing) Nothing $ do
  -- written the way a run writes state: from a root, under a block hash
  parentRoot <- withCurrentBlockHash (hash "parent") $ do
    startFromStateRoot =<< currentRoot
    writeGovernance [(a, 100), (b, 100)]
    flushMemDBs
    currentRoot
  template <- liftIO $ generate genBlockHeaderV3
  let parent = case template of
        h@BlockHeaderV3 {} ->
          h
            { number = 2000000,
              stateRoot = parentRoot,
              timestamp = posixSecondsToUTCTime 1700000000,
              currentValidators = [a, b],
              newValidators = [],
              removedValidators = [],
              currentStakes = [(a, 100), (b, 100)],
              stakeUpdates = []
            }
        h -> h
  processNewBestBlock (hash "parent") parent []
  state <- getBaggerState
  putBaggerState
    state
      { B.seen = S.insert (otHash transfer) (B.seen state),
        B.miningCache = (B.miningCache state) {B.promotedTransactions = [transfer]}
      }
  body parentRoot

spec :: Spec
spec = do
  describe "consensus changes read from contract state" $ do
    let inForce = S.fromList [a, b, c]
        stakes = M.fromList [(a, 10), (b, 20), (c, 30)]

    it "carries nothing when state holds exactly what is in force" $ do
      let (vd, sd) = consensusDeltasFromHeld inForce stakes [(a, 10), (b, 20), (c, 30)]
      fromDelta vd `shouldBe` ([], [])
      sd `shouldBe` M.empty

    it "adds, removes and re-weighs to reach what state holds" $ do
      let (vd, sd) = consensusDeltasFromHeld inForce stakes [(d, 5), (a, 10), (c, 31)]
      fromDelta vd `shouldBe` ([d], [b])
      sd `shouldBe` M.fromList [(c, 31), (d, 5)]

    it "writes its lists in ascending order whatever order state lists them in" $ do
      let one = consensusDeltasFromHeld S.empty M.empty [(d, 1), (b, 1), (c, 1), (a, 1)]
          other = consensusDeltasFromHeld S.empty M.empty [(a, 1), (c, 1), (b, 1), (d, 1)]
      fromDelta (fst one) `shouldBe` ([a, b, c, d], [])
      fromDelta (fst one) `shouldBe` fromDelta (fst other)
      snd one `shouldBe` snd other

    it "treats a validator without a weight on record as weighing zero" $ do
      -- no entry in force and zero in state: nothing to say
      snd (consensusDeltasFromHeld (S.fromList [a]) M.empty [(a, 0)]) `shouldBe` M.empty
      -- a weight in force that state no longer holds is written down as zero
      snd (consensusDeltasFromHeld (S.fromList [a]) (M.fromList [(a, 7)]) [(a, 0)]) `shouldBe` M.fromList [(a, 0)]

    it "holds the first weights back until every validator has one" $ do
      let set = S.fromList [a, b, c]
      -- one vote each today; state has a weight for one validator only
      let (vd, sd) = consensusDeltasFromHeld set M.empty [(a, 0), (b, 0), (c, 0), (d, 1000)]
      fromDelta vd `shouldBe` ([d], [])
      sd `shouldBe` M.empty
      -- every validator has one: the weights arrive together
      snd (consensusDeltasFromHeld set M.empty [(a, 5), (b, 6), (c, 7)]) `shouldBe` M.fromList [(a, 5), (b, 6), (c, 7)]
      -- once weights are in force, a validator without one is written as state has it
      snd (consensusDeltasFromHeld set (M.fromList [(a, 5), (b, 6), (c, 7)]) [(a, 5), (b, 0), (c, 7)]) `shouldBe` M.fromList [(b, 0)]

    it "leaves out an entry that does not read as an address, and reads the rest" $ do
      -- address(0) is stored as a default: the entry at 1 reads as nothing
      read' <- runEff . withNoLogger . evalMemContextM (const $ pure Nothing) Nothing $ do
        let put :: [StoragePathPiece] -> BasicValue -> ContextM ()
            put path = putSolidStorageKeyVal' (Address 0x100) (StoragePath path)
        put [Field "validators", Field "length"] (BInteger 3)
        forM_ [(0 :: Int, a, 10), (2, c, 30)] $ \(i, Validator v, w) -> do
          put [Field "validators", Index (BC.pack $ show i)] (BAddress v)
          put [Field "validatorStake", Index (BC.pack $ show v)] (BInteger w)
        governanceValidatorsAndStakes
      read' `shouldBe` ([(a, 10), (c, 30)], [1])

    it "changes nothing when state gives it nothing to go by" $ do
      let (vd, sd) = consensusDeltasFromHeld inForce stakes []
      fromDelta vd `shouldBe` ([], [])
      sd `shouldBe` M.empty

    it "leaves the consensus layer holding exactly what state holds" $
      property $ \(inForceKeys :: [Word]) (weights :: [(Word, NonNegative Integer)]) (heldRaw :: [(Word, NonNegative Integer)]) -> do
        let v = Validator . fromIntegral
            inForce' = S.fromList (map v inForceKeys)
            stakes' = M.fromList [(v k, getNonNegative w) | (k, w) <- weights]
            held = M.toList $ M.fromList [(v k, getNonNegative w) | (k, w) <- heldRaw]
            (set', stakes'') = applied inForce' stakes' held
            firstWeightsPartial = all (<= 0) (M.elems stakes') && any ((<= 0) . snd) held && any ((> 0) . snd) held
        if null held
          then (set', stakes'') `shouldBe` (inForce', stakes')
          else do
            set' `shouldBe` S.fromList (map fst held)
            if firstWeightsPartial
              then all (<= 0) [M.findWithDefault 0 k stakes'' | (k, _) <- held] `shouldBe` True
              else [M.findWithDefault 0 k stakes'' | (k, _) <- held] `shouldBe` map snd held

  describe "the shadow comparison before the fork" $ do
    let inForce = S.fromList [a, b, c]
        stakes = M.fromList [(a, 10), (b, 20), (c, 30)]
        fromState held = consensusDeltasFromHeld inForce stakes held

    it "agrees when events and state leave the same set and weights, however the changes are written" $ do
      -- events re-publish an unchanged weight and add then remove a validator; state shows neither
      let fromEvents = (toDelta [d] [d], M.fromList [(a, 10), (c, 31)])
      shadowMismatch inForce stakes fromEvents (fromState [(a, 10), (b, 20), (c, 31)]) `shouldBe` Nothing
      consensusOutcome inForce stakes fromEvents `shouldBe` (inForce, M.fromList [(a, 10), (b, 20), (c, 31)])

    it "reports a validator that events add and state does not hold" $ do
      -- the rolled-back call: its ValidatorAdded and ValidatorStakeUpdated events, nothing in storage
      let fromEvents = (toDelta [d] [], M.fromList [(d, 1000)])
      shadowMismatch inForce stakes fromEvents (fromState [(a, 10), (b, 20), (c, 30)]) `shouldSatisfy` isJust

    it "reports a weight that state holds and no event carried" $ do
      let fromEvents = (toDelta [] [], M.empty)
      shadowMismatch inForce stakes fromEvents (fromState [(a, 10), (b, 25), (c, 30)]) `shouldSatisfy` isJust

    it "treats a weight of zero and no weight at all as the same" $ do
      let fromEvents = (toDelta [] [], M.fromList [(b, 0)])
      shadowMismatch inForce stakes fromEvents (fromState [(a, 10), (b, 0), (c, 30)]) `shouldBe` Nothing
      snd (consensusOutcome inForce stakes fromEvents) `shouldBe` M.fromList [(a, 10), (c, 30)]

  describe "a run that was to pay the block rewards" $ do
    it "is thrown away when it failed without running a transaction" $
      discardsRewardRun True True True `shouldBe` True

    it "is kept when it ran a transaction, succeeded, or was not the paying run" $ do
      discardsRewardRun True True False `shouldBe` False
      discardsRewardRun True False False `shouldBe` False
      discardsRewardRun False True True `shouldBe` False

  describe "a block candidate built from the mining cache" $ do
    it "is rebuilt with the state and the weight change its cached transactions left" $ do
      (parentRoot, first, rebuilt, verifier) <- onParent $ \root -> do
        built <- obBlockData <$> makeNewBlock runRaisingB (Address 0x5e1f)
        -- nothing new is promoted, so the candidate is rebuilt from the cache alone
        block <- makeNewBlock (\_ _ _ _ _ -> error "nothing new to run") (Address 0x5e1f)
        -- what a verifier derives once it has run the block and stands on its state
        let header = obBlockData block
        startFromStateRoot (stateRoot header)
        derived <- blockConsensusDeltas (number header) (S.fromList $ getBlockValidators header) (M.fromList $ getBlockStakes header) []
        pure (root, built, block, derived)
      stateRoot first `shouldNotBe` parentRoot
      getBlockStakeUpdates first `shouldBe` [(b, 300)]
      obReceiptTransactions rebuilt `shouldBe` [transfer]
      obBlockData rebuilt `shouldBe` first
      fromDelta (fst verifier) `shouldBe` (getBlockNewValidators first, getBlockRemovedValidators first)
      snd verifier `shouldBe` M.fromList (getBlockStakeUpdates first)

    it "stands on the cache's state, not on a discarded run's" $ do
      (parentRoot, built, held) <- onParent $ \root -> do
        block <- makeNewBlock runFailingWithNothingRun (Address 0x5e1f)
        startFromStateRoot (stateRoot $ obBlockData block)
        (,,) root block . fst <$> governanceValidatorsAndStakes
      obReceiptTransactions built `shouldBe` []
      stateRoot (obBlockData built) `shouldBe` parentRoot
      getBlockStakeUpdates (obBlockData built) `shouldBe` []
      -- the candidate's state is the parent's, where b still weighs 100
      held `shouldBe` [(a, 100), (b, 100)]
