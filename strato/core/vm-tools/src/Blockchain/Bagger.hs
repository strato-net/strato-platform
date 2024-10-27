{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fprof-auto -fprof-cafs #-}
module Blockchain.Bagger where

import BlockApps.Crossmon
import BlockApps.Logging
import qualified Blockchain.Bagger.BaggerState as B
import Blockchain.Bagger.Transactions
import Blockchain.Blockstanbul.Authentication
--import           Blockchain.Data.Block

import Blockchain.DB.ChainDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.StorageDB
import qualified Blockchain.Data.AddressStateDB as DD
import Blockchain.Data.BlockHeader
import qualified Blockchain.Data.DataDefs as DD
import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.Data.Transaction
import qualified Blockchain.Data.TransactionDef as TD
import Blockchain.Data.TransactionResult
import Blockchain.Database.MerklePatricia (StateRoot (..))
import Blockchain.Sequencer.Event (OutputBlock (..), OutputTx (..))
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Delta
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Timing
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VMContext hiding (state)
import Blockchain.VMMetrics
import Blockchain.VMOptions
import qualified Blockchain.Verification as V
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Extra
import Control.Monad.IO.Class
import Control.Monad.Trans.Class (lift)
import Control.Monad.Trans.Except
import qualified Data.Binary as Bin
import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as BL
import qualified Data.DList as DL
import qualified Data.Map as M
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Time.Clock
import Data.Time.Clock.POSIX (posixSecondsToUTCTime, utcTimeToPOSIXSeconds)
import Executable.EVMFlags (flags_maxTxsPerBlock)
import Text.Format

{-# NOINLINE baggerBlockHash #-}
baggerBlockHash :: Keccak256
baggerBlockHash = hash "This is the bagger block hash. It is a dummy value used to keep track of the bagger's state roots through time"

type MonadBagger m =
  ( VMBase m,
    Mod.Accessible IsBlockstanbul m,
    Mod.Accessible TRC.Cache m,
    Mod.Modifiable B.BaggerState m,
    Mod.Yields m TransactionResult
  )

data TxMiningResult = TxMiningResult
  { tmrFailure :: Maybe TransactionFailureCause,
    tmrRanTxs :: [TxRunResult],
    tmrUnranTxs :: [OutputTx],
    tmrRemGas :: Integer
  }
  deriving (Show)

type MineTransactions m = BlockHeader -> Integer -> [OutputTx] -> Address -> m TxMiningResult

isBlockstanbul :: (Functor m, Mod.Accessible IsBlockstanbul m) => m Bool
isBlockstanbul = unIsBlockstanbul <$> Mod.access (Mod.Proxy @IsBlockstanbul)

getBaggerState :: Mod.Modifiable B.BaggerState m => m B.BaggerState
getBaggerState = Mod.get (Mod.Proxy @B.BaggerState)

putBaggerState :: Mod.Modifiable B.BaggerState m => B.BaggerState -> m ()
putBaggerState = Mod.put (Mod.Proxy @B.BaggerState)

runFromStateRoot :: MonadBagger m => MineTransactions m -> Integer -> BlockHeader -> [OutputTx] -> Address -> m (Either RunAttemptError (StateRoot, [TxRunResult], Integer))
runFromStateRoot mineTransactions remainingGas theBlockHeader txs mSelfAddress= do
  A.insert (A.Proxy @StateRoot) (Nothing :: Maybe Word256) (stateRoot theBlockHeader)
  (TxMiningResult res ranTxs unranTxs newGas) <-
    timeit "mineTransactions bagger" (Just vmBlockInsertionMined) $
      mineTransactions theBlockHeader remainingGas txs mSelfAddress
  timeit "flushMemStorageDB bagger" (Just vmBlockInsertionMined) flushMemStorageDB
  timeit "flushMemAddressStateDB bagger" (Just vmBlockInsertionMined) flushMemAddressStateDB
  newStateRoot <- A.lookupWithDefault (A.Proxy @StateRoot) (Nothing :: Maybe Word256)
  let recoverable f = Left (RecoverableFailure (tfToBaggerTxRejection f) ranTxs unranTxs newStateRoot newGas)
  return $ case res of -- currently only get GasLimit errors out of mineTransactions'
    Nothing -> Right (newStateRoot, ranTxs, newGas)
    Just TFBlockGasLimitExceeded {} -> Left (GasLimitReached ranTxs unranTxs newStateRoot newGas)
    Just f@TFIntrinsicGasExceedsTxLimit {} -> recoverable f
    Just f@TFChainIdMismatch {} -> recoverable f
    Just f@TFNonceMismatch {} -> error $ "mineTransactions' we messed up: " ++ format f
    Just f@TFCodeCollectionNotFound {} -> recoverable f
    Just f@TFInvalidPragma {} -> recoverable f
    Just f@TFNonceLimitExceeded {} -> recoverable f
    Just f@TFTXSizeLimitExceeded {} -> recoverable f
    Just f@TFKnownFailedTX {} -> recoverable f
    Just f@TFTransactionGasExceeded {} -> recoverable f

-- rewardCoinbases :: MonadBagger m => ChainMemberParsedSet -> [BlockHeader] -> Integer -> m StateRoot -- miner coinbase -> known uncles -> this block number -> stateRoot
-- rewardCoinbases us uncles ourNumber = do
--     _ <- addToBalance (Account us Nothing) $ rewardBase flags_testnet
--     forM_ uncles $ \uncle -> do
--         _ <- addToBalance (Account us Nothing) (rewardBase flags_testnet `quot` 32)
--         _ <- addToBalance (Account (beneficiary uncle) Nothing) ((rewardBase flags_testnet * (8+number uncle - ourNumber )) `quot` 8)
--         return ()
--     flushMemStorageDB
--     flushMemAddressStateDB
--     A.lookupWithDefault (A.Proxy @StateRoot) (Nothing :: Maybe Word256)

-- todo batch insert results
txsDroppedCallback :: MonadBagger m => [TxRejection] -> [Keccak256] -> m () -- called when a Tx is dropped from/rejected by the pool
txsDroppedCallback rejections bestBlockShas = forM_ rejections $ \rejection -> do
  let (message, theHash) = baggerRejectionToTransactionResultBits rejection
  -- if a tx is dropped from Queued during demotion, it means it was likely culled during the demotion as the
  -- new best block we just mined came in
  let isRecentlyRan = theHash `elem` bestBlockShas
  when (not isRecentlyRan) $ do
    $logInfoS "txsDroppedCallback" . T.pack $ "Transaction rejection :: " ++ format theHash
    $logInfoS "txsDroppedCallback" . T.pack $ "Reason: " ++ message
    Mod.yield
      DD.TransactionResult
        { transactionResultBlockHash = unsafeCreateKeccak256FromWord256 0,
          transactionResultTransactionHash = theHash,
          transactionResultMessage = message,
          transactionResultResponse = "",
          transactionResultTrace = "rejected",
          transactionResultGasUsed = 0,
          transactionResultEtherUsed = 0,
          transactionResultContractsCreated = "",
          transactionResultContractsDeleted = "",
          transactionResultStateDiff = "",
          transactionResultTime = 0,
          transactionResultNewStorage = "",
          transactionResultDeletedStorage = "",
          transactionResultStatus = Just (txRejectionToAPIFailureCause rejection),
          transactionResultChainId = txChainId . otBaseTx $ rejectedTx rejection,
          transactionResultKind = Nothing,
          transactionResultCreator = "",
          transactionResultAppName = ""
        }

-- Would it make more sense to expand the MiningCache than to introduce a separate cache?
cacheRunResults :: MonadBagger m => BlockHeader -> (StateRoot, Integer, [TxRunResult]) -> m ()
cacheRunResults bd (sr, gasRemaining, trrs) = do
  -- Private run results should not be cached, as on the second run
  -- the hydrated transaction will reach a different stateroot.
  -- Filtering them out makes the assumption that the inclusion of the unhydrated
  -- private txs reach the same stateroot as the public txs alone.
  let publicTrrs = filter ((== Nothing) . txChainId . trrTransaction) trrs
      bhash = blockHeaderPartialHash bd
  $logInfoLS "cacheRunResults" (bhash, length publicTrrs)
  $logDebugLS "cacheRunResults" bd
  cache <- Mod.access (Mod.Proxy @TRC.Cache)
  liftIO $ TRC.insert cache bhash (sr, gasRemaining, publicTrrs)

getCachedRunResults :: MonadBagger m => BlockHeader -> m (Maybe (StateRoot, Integer, [TxRunResult]))
getCachedRunResults bd = do 
    cache <- Mod.access (Mod.Proxy @TRC.Cache)
    let pHash = blockHeaderPartialHash bd
    mres <- liftIO $ TRC.lookup cache pHash
    case mres of
      Nothing -> do
        $logInfoLS "getCachedRunResults/cache_miss" . T.pack $ format pHash
        $logDebugLS "getCacheRunResults/cache_miss" bd
        return Nothing
      Just (sr, gasRemaining, trrs) -> do
        $logInfoLS "getCachedRunResults/cache_hit" . T.pack $ format pHash
        let trrs' = map (rewriteBlockHash (blockHeaderHash bd)) trrs
        return $ Just (sr, gasRemaining, trrs')

baggerRejectionToTransactionResultBits :: TxRejection -> (String, Keccak256) -- pretty, txHash
baggerRejectionToTransactionResultBits rejection = case rejection of
  WrongChainId s q OutputTx {otHash = hsh, otBaseTx = bt} ->
    (p' s q ++ "chainId (expected: main, actual: " ++ TD.formatChainId (txChainId bt) ++ ")", hsh)
  NonceTooLow s q expected OutputTx {otHash = hsh, otBaseTx = bt} ->
    (p' s q ++ "tx nonce (expected: " ++ show expected ++ ", actual: " ++ show (transactionNonce bt) ++ ")", hsh)
  BalanceTooLow s q needed actual OutputTx {otHash = hsh} ->
    (p' s q ++ "account balance (expected: " ++ show needed ++ ", actual: " ++ show actual ++ ")", hsh)
  GasLimitTooLow s q _ OutputTx {otHash = hsh} ->
    (p' s q ++ "tx gas limit", hsh)
  LessLucrative s q OutputTx {otHash = hashBetter} OutputTx {otHash = hashWorse} ->
    (p s q ++ formatKeccak256WithoutColor hashBetter ++ " being a more lucrative transaction", hashWorse)
  CodeNotFound s q a n OutputTx {otHash = h} ->
    (p s q ++ " code not found at address " ++ format a ++ " with name " ++ n, h)
  InvalidPragma s q erPragmas OutputTx {otHash = hsh} ->
    (p s q ++ " invalid pragma " ++ show erPragmas, hsh)
  NonceLimitExceeded s q e l OutputTx {otHash = hsh} ->
    (p s q ++ "account nonce limit exceeded. Limit: " ++ show l ++ " Actual: " ++ show e, hsh)
  TXSizeLimitExceeded s q e l OutputTx {otHash = hsh} ->
    (p s q ++ "tx size limit exceeded. Limit: " ++ show l ++ " Actual: " ++ show e, hsh)
  GasLimitExceeded s q e l OutputTx {otHash = hsh} ->
    (p s q ++ "transaction gas limit exceeded. Limit: " ++ show l ++ " Actual: " ++ show e, hsh)
  KnownFailedTX s q OutputTx {otHash = hsh} ->
    (p s q ++ "known failed tx: " ++ show hsh, hsh)
  where
    p stage queue = "Rejected from mempool at " ++ show stage ++ "/" ++ show queue ++ " due to "
    p' s q = p s q ++ "low "

getCheckpointableState :: MonadBagger m => m BlockHeader
getCheckpointableState = do
  state <- getBaggerState
  let miningCache = B.miningCache state
      bestHeader = B.bestBlockHeader miningCache
  return bestHeader

updateBaggerState :: MonadBagger m => (B.BaggerState -> B.BaggerState) -> m ()
updateBaggerState f = putBaggerState =<< (f <$> getBaggerState)

addTransactionsToMempool :: MonadBagger m => [OutputTx] -> m ()
addTransactionsToMempool ts = do
  let publicTxs = filter ((/= PrivateHash) . txType) ts
      privateTxs = filter ((== PrivateHash) . txType) ts
  $logDebugS "Bagger.addTransactionsToMempool" $ T.pack $ "Adding " ++ show (length ts) ++ " txs"
  withBagger $ do
    sequence_ (addToQueued Insertion <$> publicTxs)
    state <- getBaggerState
    let cache = B.miningCache state
        hashes = B.privateHashes cache `DL.append` DL.fromList privateTxs
    putBaggerState state {B.miningCache = cache {B.privateHashes = hashes}}
    promoteExecutables

processNewBestBlock :: MonadBagger m => Keccak256 -> BlockHeader -> [Keccak256] -> m ()
processNewBestBlock bh bd txShas = do
  $logDebugS "Bagger.processNewBestBlock" . T.pack $ "called with " ++ show (length txShas) ++ " txs"
  state <- getBaggerState
  -- This will be rounded in RLPEncode, but just for consistency.
  -- Really, it should just be Int and then we wouldn't need to worry about leap seconds.
  time <- posixSecondsToUTCTime . fromInteger . round . utcTimeToPOSIXSeconds <$> liftIO getCurrentTime
  let pHashes = B.privateHashes $ B.miningCache state
      shaSet = S.fromList txShas
      f = not . (`S.member` shaSet) . txHash . otBaseTx
      hashMap = DL.fromList . filter f $ DL.toList pHashes
      thisStateRoot = stateRoot bd

      newMiningCache =
        B.MiningCache
          { B.bestBlockSHA = bh,
            B.bestBlockHeader = bd,
            B.bestBlockTxHashes = txShas,
            B.lastExecutedStateRoot = thisStateRoot,
            B.remainingGas = nextGasLimit . getBlockGasLimit $ bd,
            B.lastExecutedTxs = [],
            B.promotedTransactions = [],
            B.privateHashes = hashMap,
            B.startTimestamp = time
          }
  $logInfoS "Bagger.processNewBestBlock" . T.pack $ show (length hashMap) ++ " private hashses in Bagger cache"
  putBaggerState $ state {B.seen = S.empty, B.miningCache = newMiningCache}
  migrateBlockHeader bd baggerBlockHash
  withBagger $ do
    demoteUnexecutables
    promoteExecutables

makeNewBlock :: MonadBagger m => MineTransactions m -> Address -> m OutputBlock
makeNewBlock mineTransactions mSelfAddress = do
  state <- getBaggerState
  let seen' = B.seen state
  let cache = B.miningCache state
  let lastExec = B.lastExecutedTxs cache
  let lastExecLen = length lastExec
  let lastExecGuardLen = length [t | t <- lastExec, otHash (trrTransaction t) `S.member` seen']
  let noCachedTxsCulled = lastExecLen == lastExecGuardLen
  if noCachedTxsCulled
    then do
      $logDebugS "Bagger.makeNewBlock" "noCachedTxsCulled = True"
      if null $ B.promotedTransactions cache
        then do
          $logDebugS "Bagger.makeNewBlock" "null $ B.promotedTransactions cache = True"
          !build <- withBagger buildFromMiningCache
          return build
        else do
          $logDebugS "Bagger.makeNewBlock" "null $ B.promotedTransactions cache = False"
          let lastSR = B.lastExecutedStateRoot cache
          let lastSHA = B.bestBlockSHA cache
          let lastHead = B.bestBlockHeader cache
          let promoted = take ((fromInteger flags_maxTxsPerBlock) - lastExecLen) $ B.promotedTransactions cache
          let time = B.startTimestamp cache
          let tempBlockHeader = buildNextBlockHeader lastHead lastSHA lastSR [] time mempty mempty
          let remGas = B.remainingGas cache
          $logDebugS "Bagger.makeNewBlock" . T.pack $ "pre-incremental run :: (" ++ show remGas ++ ", " ++ format lastSR ++ ")"
          withBagger $ do
            !run <- runFromStateRoot mineTransactions remGas tempBlockHeader promoted mSelfAddress
            (newSR, newGas, newExec, newUnexec) <- case run of
              Right (newSR', newRR', newGas') -> return (newSR', newGas', lastExec ++ newRR', [])
              Left e -> do
                logRAE e
                case e of
                  (GasLimitReached rtx urtx nsr nbg) -> return (nsr, nbg, lastExec ++ rtx, urtx)
                  (RecoverableFailure f rtx urtx nsr nbg) -> do
                    txsDroppedCallback [f] []
                    let theRejectedTx = rejectedTx f
                    purgeFromPending theRejectedTx
                    return (nsr, nbg, lastExec ++ rtx, filter (/= theRejectedTx) urtx)
                  x -> error (show x)

            let !newMiningCache =
                  cache
                    { B.lastExecutedStateRoot = newSR,
                      B.remainingGas = newGas,
                      B.lastExecutedTxs = newExec,
                      B.promotedTransactions = newUnexec
                    }
            $logDebugS "Bagger.makeNewBlock" . T.pack $ "post-incremental run :: (" ++ show newGas ++ ", " ++ format newSR ++ ")"
            updateBaggerState (\s -> s {B.miningCache = newMiningCache})
            !build <- buildFromMiningCache
            $logInfoS "Bagger.makeNewBlock" . T.pack $ "Returned from buildFromMiningCache with stateRoot " ++ show (stateRoot $ obBlockData build)
            return build
    else do
      -- some transactions which were cached have been evicted, need to recalculate entire block cache
      $logDebugS "Bagger.makeNewBlock" "noCachedTxsCulled = False"
      let sha = B.bestBlockSHA cache
      let header = B.bestBlockHeader cache
      let txShas = B.bestBlockTxHashes cache
      processNewBestBlock sha header txShas
      !nb <- makeNewBlock mineTransactions mSelfAddress
      return nb

setCalculateIntrinsicGas :: MonadBagger m => (Integer -> OutputTx -> Integer) -> m ()
setCalculateIntrinsicGas cig = putBaggerState =<< (\s -> s {B.calculateIntrinsicGas = cig}) <$> getBaggerState

logRAE :: (MonadLogger m) => RunAttemptError -> m ()
logRAE rae = do
  $logWarnS "Bagger.logRunAttemptError" "!!!!!!!!!!!!!!!!!!!"
  mapM_ ($logWarnS "Bagger.logRunAttemptError" . T.pack) $ case rae of
    CantFindStateRoot -> ["Cant find state root!"]
    GasLimitReached r u _ g -> ["Hit gas limit!", show (length r) ++ "/" ++ show (length u) ++ " ran/unran. remgas: " ++ show g]
    RecoverableFailure f r u _ g ->
      concat
        [ ["(Ideally) recoverable failure!"],
          [show (length r) ++ "/" ++ show (length u) ++ " ran/unran. remgas: " ++ show g],
          lines (format f)
        ]
  $logWarnS "Bagger.logRunAttemptError" "!!!!!!!!!!!!!!!!!!!"

logReady :: (MonadLogger m) => String -> Address -> OutputTx -> m ()
logReady prefix address OutputTx {otHash = h, otBaseTx = t} = do
  $logDebugS "Bagger.logReady++++++++" "+++++++++++++++++++"
  $logDebugS "Bagger.logReady+status " . T.pack $ prefix
  $logDebugS "Bagger.logReady+address" . T.pack $ format address
  $logDebugS "Bagger.logReady+hash   " . T.pack $ format h
  $logDebugS "Bagger.logReady+nonce  " . T.pack $ show (TD.transactionNonce t)
  $logDebugS "Bagger.logReady++++++++" "+++++++++++++++++++"

logDiscard :: (MonadLogger m) => String -> Address -> Integer -> OutputTx -> m ()
logDiscard prefix address expectation OutputTx {otHash = h, otBaseTx = t} = do
  $logDebugS "Bagger.logDiscard========" "==================="
  $logDebugS "Bagger.logDiscard=status " . T.pack $ prefix
  $logDebugS "Bagger.logDiscard=expect " . T.pack $ show expectation
  $logDebugS "Bagger.logDiscard=address" . T.pack $ format address
  $logDebugS "Bagger.logDiscard=hash   " . T.pack $ format h
  $logDebugS "Bagger.logDiscard=nonce  " . T.pack $ show (TD.transactionNonce t)
  $logDebugS "Bagger.logDiscard========" "==================="

logDiscard' :: (MonadLogger m) => String -> Address -> OutputTx -> m ()
logDiscard' prefix address OutputTx {otHash = h, otBaseTx = t} = do
  $logDebugS "Bagger.logDiscard'--------" "-------------------"
  $logDebugS "Bagger.logDiscard'-status " . T.pack $ prefix
  $logDebugS "Bagger.logDiscard'-address" . T.pack $ format address
  $logDebugS "Bagger.logDiscard'-hash   " . T.pack $ format h
  $logDebugS "Bagger.logDiscard'-nonce  " . T.pack $ show (TD.transactionNonce t)
  $logDebugS "Bagger.logDiscard'--------" "-------------------"

addToQueued :: MonadBagger m => BaggerStage -> OutputTx -> m ()
addToQueued stage t@OutputTx {otSigner = signer} =
  unlessM (wasSeen t) $ do
    state <- getBaggerState
    let txShas = B.bestBlockTxHashes (B.miningCache state)
    validation <- isValidForPool t
    $logDebugS "Bagger.addToQueued" . T.pack $ "validation :: " ++ show validation
    case validation of
      Left rejection -> do
        $logDebugS "Bagger.addToQueued/Left" . T.pack $ "rejection :: " ++ show rejection
        txsDroppedCallback [rejection] txShas
      Right _ -> do
        $logDebugS "Bagger.addToQueued/Right" "non-rejection "
        !(toDiscard, newState) <- B.addToQueued t <$> getBaggerState
        putBaggerState newState
        $logDebugS "Bagger.addToQueued/Right" . T.pack $ show newState
        forM_ toDiscard $ \d -> do
          removeFromSeen d
          logDiscard' "addToQueued" signer d
          txsDroppedCallback [LessLucrative stage Queued t d] txShas
        addToSeen t

promoteExecutables :: MonadBagger m => m ()
promoteExecutables = do
  preState <- getBaggerState
  $logInfoS "Bagger.promoteExecutables" "pulling from mempool"
  let txShas = B.bestBlockTxHashes (B.miningCache preState)
      queued' = M.keysSet (B.queued preState)
  forM_ queued' $ \address -> do
    state <- getBaggerState
    (addressNonce, addressBalance) <- getAddressNonceAndBalance address

    let !(discardedByNonce, state') = B.trimBelowNonceFromQueued address addressNonce state
    putBaggerState state'
    forM_ discardedByNonce $ \d -> do
      removeFromSeen d
      logDiscard "promoteExecutables Queued Nonce" address addressNonce d

    let !(discardedByCost, state'') = B.trimAboveCostFromQueued address addressBalance state'
    putBaggerState state''
    forM_ discardedByCost $ \d -> do
      removeFromSeen d
      logDiscard "promoteExecutables Queued Balance" address addressBalance d

    let !(readyToMine, state''') = B.popSequentialFromQueued address addressNonce state''
    putBaggerState state'''
    forM_ readyToMine $ logReady "promoteExecutables Ready-to-mine!" address

    calcFee <- B.calculateIntrinsicTxFee <$> getBaggerState
    -- todo callback per promotion call instead of per-address?
    let nonceDrops = NonceTooLow Promotion Queued addressNonce <$> discardedByNonce
    let costDrops = (\t -> BalanceTooLow Promotion Queued (calcFee t) addressBalance t) <$> discardedByCost
    txsDroppedCallback (nonceDrops ++ costDrops) txShas
    forM_ readyToMine promoteTx

promoteTx :: MonadBagger m => OutputTx -> m ()
promoteTx tx@OutputTx {otSigner = signer} = do
  state <- getBaggerState
  $logInfoS "Bagger.promoteTx" "pulling from mempool"
  let txShas = B.bestBlockTxHashes (B.miningCache state)
      !(evicted, kept, state') = B.addToPending tx state
  putBaggerState state'
  forM_ evicted $ \e -> do
    removeFromSeen e
    logDiscard' "promoteTx" signer e
    txsDroppedCallback [LessLucrative Promotion Pending kept e] txShas
  addToPromotionCache tx

demoteUnexecutables :: MonadBagger m => m ()
demoteUnexecutables = do
  preState <- getBaggerState
  $logInfoS "Bagger.demoteUnexecutables" "pulling from mempool"
  let txShas = B.bestBlockTxHashes (B.miningCache preState)
      pending' = M.keysSet (B.pending preState)
  forM_ pending' $ \address -> do
    state <- getBaggerState
    (addressNonce, addressBalance) <- getAddressNonceAndBalance address

    let !(pDiscardedByNonce, state') = B.trimBelowNonceFromPending address addressNonce state
    putBaggerState state'
    forM_ pDiscardedByNonce removeFromSeen
    forM_ pDiscardedByNonce $ logDiscard "demoteUnexecutables Pending Nonce" address addressNonce

    let !(pDiscardedByCost, state'') = B.trimAboveCostFromPending address addressBalance state'
    putBaggerState state''
    forM_ pDiscardedByCost removeFromSeen
    forM_ pDiscardedByCost $ logDiscard "demoteUnexecutables Pending Balance" address addressBalance

    state'''' <- getBaggerState
    let !(qDiscardedByNonce, state''''') = B.trimBelowNonceFromQueued address addressNonce state''''
    putBaggerState state'''''
    forM_ qDiscardedByNonce removeFromSeen
    forM_ qDiscardedByNonce $ logDiscard "demoteUnexecutables Queued Nonce" address addressNonce

    let !(qDiscardedByCost, state'''''') = B.trimAboveCostFromQueued address addressBalance state'''''
    putBaggerState state''''''
    forM_ qDiscardedByCost removeFromSeen
    forM_ qDiscardedByCost $ logDiscard "demoteUnexecutables Queued Balance" address addressBalance

    calcFee <- B.calculateIntrinsicTxFee <$> getBaggerState

    -- todo callback per demotion call instead of per-address?
    let pNonceDrops = NonceTooLow Demotion Pending addressNonce <$> pDiscardedByNonce
    let pCostDrops = (\t -> BalanceTooLow Demotion Pending (calcFee t) addressBalance t) <$> pDiscardedByCost
    let qNonceDrops = NonceTooLow Demotion Queued addressNonce <$> qDiscardedByNonce
    let qCostDrops = (\t -> BalanceTooLow Demotion Queued (calcFee t) addressBalance t) <$> qDiscardedByCost
    txsDroppedCallback (pNonceDrops ++ pCostDrops ++ qNonceDrops ++ qCostDrops) txShas

    -- drop all existing pending transactions, and try to see if they're
    -- still valid to add to the (likely new) queued pool
    let !(remainingPending, state''') = B.popAllPending state''
    putBaggerState state'''
    forM_ remainingPending $ \p -> do
      removeFromSeen p
      addToQueued Demotion p

wasSeen :: MonadBagger m => OutputTx -> m Bool
wasSeen OutputTx {otHash = sha} = do
  ret <- (S.member sha) . B.seen <$> getBaggerState
  --  $logDebugS "Bagger.wasSeen" . T.pack $ "wasSeen " ++ (show sha) ++ " = " ++ (show ret)
  return ret

isValidForPool :: MonadBagger m => OutputTx -> m (Either TxRejection ())
isValidForPool t@OutputTx {otSigner = address, otBaseTx = bt} = runExceptT $ do
  -- todo: is this everything that can be checked? be more pedantic and check for neg. balance, etc?
  state <- lift getBaggerState
  let intrinsicGas = B.calculateIntrinsicGasAtNextBlock state t
      txn = TD.transactionNonce bt
      txFee = B.calculateIntrinsicTxFee state t
      txSize = toInteger $ BS.length $ BL.toStrict $ Bin.encode bt
  when (intrinsicGas >= flags_gasLimit)
    . throwE
    $ GasLimitExceeded Validation Incoming intrinsicGas flags_gasLimit t
  (addressNonce, addressBalance) <- lift $ getAddressNonceAndBalance address
  when (addressNonce > txn)
    . throwE
    $ NonceTooLow Validation Incoming addressNonce t
  when (addressNonce >= flags_accountNonceLimit)
    . throwE
    $ NonceLimitExceeded Validation Incoming addressNonce flags_accountNonceLimit t
  when (addressBalance < txFee)
    . throwE
    $ BalanceTooLow Validation Incoming txFee addressBalance t
  when (txSize >= toInteger flags_txSizeLimit)
    . throwE
    $ TXSizeLimitExceeded Validation Incoming txSize (toInteger flags_txSizeLimit) t
  when (otHash t `S.member` knownFailedTxs)
    . throwE
    $ KnownFailedTX Validation Incoming t
  return ()

addToSeen :: MonadBagger m => OutputTx -> m ()
addToSeen t = updateBaggerState (B.addToSeen t)

removeFromSeen :: MonadBagger m => OutputTx -> m ()
removeFromSeen t = updateBaggerState (B.removeFromSeen t)

getAddressNonceAndBalance :: MonadBagger m => Address -> m (Integer, Integer)
getAddressNonceAndBalance addr = do
  nonce <- DD.addressStateNonce <$> A.lookupWithDefault (A.Proxy @DD.AddressState) (Account addr Nothing)
  return (nonce, 9999999999999999999999999999) -- gas off; fake a high balance, so all TXs are accepted

addToPromotionCache :: MonadBagger m => OutputTx -> m ()
addToPromotionCache tx = updateBaggerState (B.addToPromotionCache tx)

purgeFromPending :: MonadBagger m => OutputTx -> m ()
purgeFromPending tx = updateBaggerState (B.purgeFromPending tx)

purgeFromQueued :: MonadBagger m => OutputTx -> m ()
purgeFromQueued tx = updateBaggerState (B.purgeFromQueued tx)

-- | Parent gas limit -> child gas limit
nextGasLimit :: Integer -> Integer
nextGasLimit g = g + q - (if d == 0 then 1 else 0) where (q, d) = g `quotRem` 1024

buildFromMiningCache :: MonadBagger m => m OutputBlock
buildFromMiningCache = do
  $logInfoS "Bagger.buildFromMiningCache" "pulling from mempool"
  state <- getBaggerState
  isPBFT <- isBlockstanbul
  let cache = B.miningCache state
  let uncles = []
  let parentHash = B.bestBlockSHA cache
  let parentHeader = B.bestBlockHeader cache
  let stateRoot = B.lastExecutedStateRoot cache
  let (vDelt, cDelt) = getDeltasFromResults $ B.lastExecutedTxs cache
  let txs = (trrTransaction <$> B.lastExecutedTxs cache) ++ (DL.toList $ B.privateHashes cache)
  let time = B.startTimestamp cache
  let nextBlockData = buildNextBlockHeader parentHeader parentHash stateRoot txs time vDelt cDelt
  recordMaxBlockNumber "bagger_build" . number $ nextBlockData
  rewardedBlockData <- buildRewardedBlockHeader nextBlockData
  when isPBFT $
    cacheRunResults rewardedBlockData (B.lastExecutedStateRoot cache, B.remainingGas cache, B.lastExecutedTxs cache)
  return
    OutputBlock
      { obOrigin = TO.Quarry,
        obBlockUncles = uncles,
        obReceiptTransactions = txs,
        obBlockData = rewardedBlockData
      }

buildNextBlockHeader ::
  BlockHeader ->
  Keccak256 ->
  StateRoot ->
  [OutputTx] ->
  UTCTime ->
  ValidatorDelta ->
  CertDelta ->
  BlockHeader
buildNextBlockHeader parentHeader parentHash stateRoot txs time vd cd =
  let parentNum = number parentHeader
      (newV, remV) = fromDelta vd
      (newC, revC) = fromDelta cd
      curValidators = case parentHeader of
        BlockHeaderV2{} -> S.toList $ S.difference
                                       (S.union
                                         (getValidatorSet parentHeader)
                                         (S.fromList $ newValidators parentHeader))
                                       (S.fromList $ removedValidators parentHeader)
        BlockHeader{} -> S.toList $ getValidatorSet parentHeader
   in BlockHeaderV2
        {
          parentHash = parentHash,
          stateRoot = stateRoot,
          transactionsRoot = V.transactionsVerificationValue (otBaseTx <$> txs),
          receiptsRoot = V.receiptsVerificationValue (),
          logsBloom = "0000000000000000000000000000000000000000000000000000000000000000",
          number = parentNum + 1,
          timestamp = time,
          extraData = txsLen2ExtraData (length txs),
          currentValidators = curValidators,
          newValidators = newV,
          removedValidators = remV,
          newCerts = newC,
          revokedCerts = revC,
          proposalSignature = Nothing,
          signatures = []
        }

buildRewardedBlockHeader :: MonadBagger m => BlockHeader -> m BlockHeader
buildRewardedBlockHeader bd = do
  $logInfoS "Bagger.buildRewardedBlockHeader" . T.pack $ "pre-reward :: (" ++ format (stateRoot bd) ++ ")"
  oldSR <- A.lookupWithDefault (A.Proxy @StateRoot) (Nothing :: Maybe Word256)
  let rewardedStateRoot = oldSR
  A.insert (A.Proxy @StateRoot) (Nothing :: Maybe Word256) oldSR
  $logInfoS "Bagger.buildRewardedBlockHeader" . T.pack $ "post-reward :: (" ++ format rewardedStateRoot ++ ")"
  return bd {stateRoot = rewardedStateRoot}

withBagger :: MonadBagger m => m a -> m a
withBagger = withCurrentBlockHash baggerBlockHash
