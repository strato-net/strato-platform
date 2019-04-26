{-# LANGUAGE BangPatterns        #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# OPTIONS -fprof-auto -fprof-cafs #-}
module Blockchain.Bagger where

import           Control.Arrow                      ((&&&))
import           Control.Monad.Extra
import           Control.Monad.IO.Class
import           Blockchain.Output
import           Control.Monad.State.Lazy           (get, put, lift)
import           Control.Monad.Trans.Except
import qualified Data.Map                           as M
import           Data.Map.Ordered                   (OMap)
import qualified Data.Map.Ordered                   as OMap
import qualified Data.Text                          as T
import           Data.Time.Clock
import qualified Data.Set                           as S
import           Data.Word
import           Numeric                            (readHex)

import           Blockapps.Crossmon

import           Blockchain.CoreFlags               (flags_difficultyBomb, flags_testnet)
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.StateDB

import qualified Blockchain.Bagger.BaggerState      as B
import           Blockchain.Bagger.Transactions
import           Blockchain.Data.Address
import qualified Blockchain.Data.AddressStateDB     as DD
import qualified Blockchain.Data.BlockDB            as BDB
import qualified Blockchain.Data.DataDefs           as DD
import qualified Blockchain.Data.TransactionDef     as TD
import qualified Blockchain.Data.TXOrigin           as TO
import           Blockchain.Database.MerklePatricia (StateRoot (..))
import qualified Blockchain.EthConf                 as Conf
import           Blockchain.Sequencer.Event         (OutputBlock (..), OutputTx (..))
import           Blockchain.SHA                     hiding (hash)
import           Blockchain.Strato.Model.Class
import           Blockchain.Util
import qualified Blockchain.Verification            as V

import           Executable.EVMFlags                (flags_maxTxsPerBlock)

import           Text.Format

class (Monad m, MonadIO m, HasHashDB m, HasStateDB m, HasMemAddressStateDB m, MonadLogger m) => MonadBagger m where
    isBlockstanbul     :: m Bool
    getBaggerState     :: m B.BaggerState
    peekPendingVote    :: m (Address, Word64)
    clearPendingVote   :: BDB.Block -> m ()
    putBaggerState     :: B.BaggerState -> m ()
    runFromStateRoot   :: StateRoot -> Integer -> DD.BlockData -> [OutputTx] -> m (Either RunAttemptError (StateRoot, [TxRunResult], Integer))
    rewardCoinbases    :: StateRoot -> Address -> [DD.BlockData] -> Integer -> m StateRoot -- miner coinbase -> known uncles -> this block number -> stateRoot
    txsDroppedCallback :: [TxRejection] -> [SHA] -> m () -- called when a Tx is dropped from/rejected by the pool
    {-# MINIMAL isBlockstanbul, getBaggerState, peekPendingVote, clearPendingVote, putBaggerState, runFromStateRoot, rewardCoinbases, txsDroppedCallback #-}

    getCheckpointableState :: m (SHA, DD.BlockData)
    getCheckpointableState = do
        state <- getBaggerState
        let miningCache = B.miningCache state
            bestSHA     = B.bestBlockSHA miningCache
            bestHeader  = B.bestBlockHeader miningCache
        return (bestSHA, bestHeader)

    updateBaggerState :: (B.BaggerState -> B.BaggerState) -> m ()
    updateBaggerState f = putBaggerState =<< (f <$> getBaggerState)

    addTransactionsToMempool :: [OutputTx] -> m ()
    addTransactionsToMempool ts = do
        let publicTxs  = filter ((/= PrivateHash) . txType) ts
            privateTxs = filter ((== PrivateHash) . txType) ts
        $logDebugS "Bagger.addTransactionsToMempool" $ T.pack $ "Adding " ++ show (length ts) ++ " txs"
        existingStateDbStateRoot <- getStateRoot
        stateRoot <- (B.lastExecutedStateRoot . B.miningCache) <$> getBaggerState
        setStateDBStateRoot stateRoot
        sequence_ (addToQueued Insertion <$> publicTxs)
        state <- getBaggerState
        let cache = B.miningCache state
            hashes' = B.privateHashes cache
            hashes = buildState hashes' privateTxs $ \tx -> do
              (st :: OMap SHA OutputTx) <- get
              let st' = st OMap.|> (txHash (otBaseTx tx), tx)
              put st'
        putBaggerState state{ B.miningCache = cache{ B.privateHashes = hashes } }
        promoteExecutables
        setStateDBStateRoot existingStateDbStateRoot

    processNewBestBlock :: SHA -> DD.BlockData -> [SHA] -> m ()
    processNewBestBlock bh bd txShas = do
        $logDebugS "Bagger.processNewBestBlock" . T.pack $ "called with " ++ show (length txShas) ++ " txs"
        existingStateDbStateRoot <- getStateRoot
        let thisStateRoot = DD.blockDataStateRoot bd
        state <- getBaggerState
        time  <- liftIO getCurrentTime
        let pHashes = B.privateHashes $ B.miningCache state
            hashMap = OMap.fromList $ map (\a -> (a,a)) txShas -- why is this not a standard function?
        let newMiningCache = B.MiningCache { B.bestBlockSHA          = bh
                                           , B.bestBlockHeader       = bd
                                           , B.bestBlockTxHashes     = txShas
                                           , B.lastExecutedStateRoot = thisStateRoot
                                           , B.remainingGas          = nextGasLimit $ DD.blockDataGasLimit bd
                                           , B.lastExecutedTxs       = []
                                           , B.promotedTransactions  = []
                                           , B.privateHashes         = pHashes OMap.\\ hashMap
                                           , B.startTimestamp        = time
                                           }
        putBaggerState $ state { B.seen = S.empty, B.miningCache = newMiningCache }
        setStateDBStateRoot thisStateRoot
        demoteUnexecutables
        promoteExecutables
        setStateDBStateRoot existingStateDbStateRoot

    makeNewBlock :: m OutputBlock
    makeNewBlock = do
        state <- getBaggerState
        let seen'       = B.seen state
        let cache       = B.miningCache state
        let lastExec    = B.lastExecutedTxs cache
        let lastExecLen = length lastExec
        let lastExecGuardLen = length [t | t  <- lastExec, otHash (trrTransaction t) `S.member` seen']
        let noCachedTxsCulled = lastExecLen == lastExecGuardLen
        if noCachedTxsCulled then do
            $logDebugS "Bagger.makeNewBlock" "noCachedTxsCulled = True"
            if null $ B.promotedTransactions cache then do
                    $logDebugS "Bagger.makeNewBlock" "null $ B.promotedTransactions cache = True"
                    !build <- buildFromMiningCache
                    return build
                else do
                    $logDebugS "Bagger.makeNewBlock" "null $ B.promotedTransactions cache = False"
                    existingStateDbStateRoot <- getStateRoot
                    isPBFT <- isBlockstanbul
                    (coinbaseAddr, nonce) <- peekPendingVote
                    let lastSR          = B.lastExecutedStateRoot cache
                    let lastSHA         = B.bestBlockSHA cache
                    let lastHead        = B.bestBlockHeader cache
                    let promoted        = take ((fromInteger flags_maxTxsPerBlock) - lastExecLen) $ B.promotedTransactions cache
                    let time            = B.startTimestamp cache
                    let tempBlockHeader = buildNextBlockHeader lastHead lastSHA [] lastSR [] time isPBFT coinbaseAddr nonce
                    let remGas          = B.remainingGas cache
                    $logDebugS "Bagger.makeNewBlock" . T.pack $ "pre-incremental run :: (" ++ show remGas ++ ", " ++ format lastSR ++ ")"
                    !run <- runFromStateRoot lastSR remGas tempBlockHeader promoted
                    (newSR, newGas, newExec, newUnexec) <- case run of
                            Right (newSR', newRR', newGas') -> return (newSR', newGas', lastExec ++ newRR', [])
                            Left e -> do
                                logRAE e
                                case e of
                                    (GasLimitReached rtx urtx nsr nbg)      -> return (nsr, nbg, lastExec ++ rtx, urtx)
                                    (RecoverableFailure f rtx urtx nsr nbg) -> do
                                        txsDroppedCallback [f] []
                                        let theRejectedTx = rejectedTx f
                                        purgeFromPending theRejectedTx
                                        return (nsr, nbg, lastExec ++ rtx, filter (/= theRejectedTx) urtx)
                                    x                                       -> error (show x)

                    let !newMiningCache = cache { B.lastExecutedStateRoot = newSR
                                                , B.remainingGas          = newGas
                                                , B.lastExecutedTxs       = newExec
                                                , B.promotedTransactions  = newUnexec
                                                }
                    $logDebugS "Bagger.makeNewBlock" . T.pack $ "post-incremental run :: (" ++ show newGas ++ ", " ++ format newSR ++ ")"
                    updateBaggerState (\s -> s { B.miningCache = newMiningCache })
                    !build <- buildFromMiningCache
                    $logInfoS "Bagger.makeNewBlock" . T.pack $ "Returned from buildFromMiningCache with stateRoot " ++ show (DD.blockDataStateRoot $ obBlockData build)
                    setStateDBStateRoot lastSR
                    setStateDBStateRoot existingStateDbStateRoot
                    return build
          else do -- some transactions which were cached have been evicted, need to recalculate entire block cache
              $logDebugS "Bagger.makeNewBlock" "noCachedTxsCulled = False"
              let sha    = B.bestBlockSHA cache
              let header = B.bestBlockHeader cache
              let txShas = B.bestBlockTxHashes cache
              processNewBestBlock sha header txShas
              !nb <- makeNewBlock
              return nb

    setCalculateIntrinsicGas :: (Integer -> OutputTx -> Integer) -> m ()
    setCalculateIntrinsicGas cig = putBaggerState =<< (\s -> s { B.calculateIntrinsicGas = cig }) <$> getBaggerState

logRAE :: (MonadLogger m) => RunAttemptError -> m ()
logRAE rae = do
    $logWarnS "Bagger.logRunAttemptError" "!!!!!!!!!!!!!!!!!!!"
    mapM_ ($logWarnS "Bagger.logRunAttemptError" . T.pack) $ case rae of
        CantFindStateRoot          -> ["Cant find state root!"]
        GasLimitReached r u _ g    -> ["Hit gas limit!",  show (length r) ++ "/" ++ show (length u) ++ " ran/unran. remgas: " ++ show g]
        RecoverableFailure f r u _ g -> concat [ ["(Ideally) recoverable failure!"]
                                               , [show (length r) ++ "/" ++ show (length u) ++ " ran/unran. remgas: " ++ show g]
                                               , lines (format f)
                                               ]
    $logWarnS "Bagger.logRunAttemptError" "!!!!!!!!!!!!!!!!!!!"

logReady :: (MonadLogger m) => String -> Address -> OutputTx -> m ()
logReady prefix address OutputTx{otHash=h, otBaseTx=t} = do
    $logDebugS "Bagger.logReady++++++++" "+++++++++++++++++++"
    $logDebugS "Bagger.logReady+status " . T.pack $ prefix
    $logDebugS "Bagger.logReady+address" . T.pack $ format address
    $logDebugS "Bagger.logReady+hash   " . T.pack $ format h
    $logDebugS "Bagger.logReady+nonce  " . T.pack $ show (TD.transactionNonce t)
    $logDebugS "Bagger.logReady++++++++" "+++++++++++++++++++"

logDiscard :: (MonadLogger m) => String -> Address -> Integer -> OutputTx -> m()
logDiscard prefix address expectation OutputTx{otHash=h, otBaseTx=t} = do
    $logDebugS "Bagger.logDiscard========" "==================="
    $logDebugS "Bagger.logDiscard=status " . T.pack $ prefix
    $logDebugS "Bagger.logDiscard=expect " . T.pack $ show expectation
    $logDebugS "Bagger.logDiscard=address" . T.pack $ format address
    $logDebugS "Bagger.logDiscard=hash   " . T.pack $ format h
    $logDebugS "Bagger.logDiscard=nonce  " . T.pack $ show (TD.transactionNonce t)
    $logDebugS "Bagger.logDiscard========" "==================="

logDiscard' :: (MonadLogger m) => String -> Address -> OutputTx -> m()
logDiscard' prefix address OutputTx{otHash=h, otBaseTx=t} = do
    $logDebugS "Bagger.logDiscard'--------" "-------------------"
    $logDebugS "Bagger.logDiscard'-status " . T.pack $ prefix
    $logDebugS "Bagger.logDiscard'-address" . T.pack $ format address
    $logDebugS "Bagger.logDiscard'-hash   " . T.pack $ format h
    $logDebugS "Bagger.logDiscard'-nonce  " . T.pack $ show (TD.transactionNonce t)
    $logDebugS "Bagger.logDiscard'--------" "-------------------"

addToQueued :: MonadBagger m => BaggerStage -> OutputTx -> m ()
addToQueued stage t@OutputTx{otSigner = signer} =
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
                -- $logDebugS "Bagger.addToQueued/Right" "non-rejection "
                !(toDiscard, newState) <- B.addToQueued t <$> getBaggerState
                putBaggerState newState
                -- $logDebugS "Bagger.addToQueued/Right" . T.pack $show newState
                forM_ toDiscard $ \d -> do
                    removeFromSeen d
                    logDiscard' "addToQueued" signer d
                    txsDroppedCallback [LessLucrative stage Queued t d] txShas
                addToSeen t

promoteExecutables :: MonadBagger m => m ()
promoteExecutables = do
    preState <- getBaggerState
    $logInfoS "Bagger.promoteExecutables" "pulling from mempool"
    let txShas   = B.bestBlockTxHashes (B.miningCache preState)
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
        let nonceDrops = NonceTooLow Promotion Queued addressNonce     <$> discardedByNonce
        let costDrops  = (\t -> BalanceTooLow Promotion Queued (calcFee t) addressBalance t) <$> discardedByCost
        txsDroppedCallback (nonceDrops ++ costDrops) txShas
        forM_ readyToMine promoteTx

promoteTx :: MonadBagger m => OutputTx -> m ()
promoteTx tx@OutputTx{otSigner=signer} = do
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
    let txShas   = B.bestBlockTxHashes (B.miningCache preState)
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
        let !(qDiscardedByNonce, state''''') = B.trimBelowNonceFromPending address addressNonce state''''
        putBaggerState state'''''
        forM_ qDiscardedByNonce removeFromSeen
        forM_ qDiscardedByNonce $ logDiscard "demoteUnexecutables Queued Nonce" address addressNonce

        let !(qDiscardedByCost, state'''''') = B.trimAboveCostFromPending address addressBalance state'''''
        putBaggerState state''''''
        forM_ qDiscardedByCost removeFromSeen
        forM_ qDiscardedByCost $ logDiscard "demoteUnexecutables Queued Balance" address addressBalance

        calcFee <- B.calculateIntrinsicTxFee <$> getBaggerState

        -- todo callback per demotion call instead of per-address?
        let pNonceDrops = NonceTooLow Demotion Pending addressNonce <$> pDiscardedByNonce
        let pCostDrops  = (\t -> BalanceTooLow Demotion Pending (calcFee t) addressBalance t) <$> pDiscardedByCost
        let qNonceDrops = NonceTooLow Demotion Queued addressNonce <$> qDiscardedByNonce
        let qCostDrops  = (\t -> BalanceTooLow Demotion Queued (calcFee t) addressBalance t) <$> qDiscardedByCost
        txsDroppedCallback (pNonceDrops ++ pCostDrops ++ qNonceDrops ++ qCostDrops) txShas

        -- drop all existing pending transactions, and try to see if they're
        -- still valid to add to the (likely new) queued pool
        let !(remainingPending, state''') = B.popAllPending state''
        putBaggerState state'''
        forM_ remainingPending $ \p -> do
            removeFromSeen p
            addToQueued Demotion p

wasSeen :: MonadBagger m => OutputTx -> m Bool
wasSeen OutputTx{otHash=sha} = do
    ret <- (S.member sha) . B.seen <$> getBaggerState
    -- $logDebugS "Bagger.wasSeen" . T.pack $ "wasSeen " ++ (show sha) ++ " = " ++ (show ret)
    return ret

isValidForPool :: MonadBagger m => OutputTx -> m (Either TxRejection ())
isValidForPool t@OutputTx{otSigner=address, otBaseTx=bt} = runExceptT $ do
    -- todo: is this everything that can be checked? be more pedantic and check for neg. balance, etc?
    state <- lift getBaggerState
    let intrinsicGas = B.calculateIntrinsicGasAtNextBlock state t
        txgl         = TD.transactionGasLimit bt
        txn          = TD.transactionNonce bt
        txFee        = B.calculateIntrinsicTxFee state t
    when (intrinsicGas > txgl) .
       throwE $ GasLimitTooLow Validation Incoming intrinsicGas t
    (addressNonce, addressBalance) <- lift $ getAddressNonceAndBalance address
    when (addressNonce > txn) .
       throwE $ NonceTooLow Validation Incoming addressNonce t
    when (addressBalance < txFee) .
       throwE $ BalanceTooLow Validation Incoming txFee addressBalance t
    return ()

addToSeen :: MonadBagger m => OutputTx -> m ()
addToSeen t = updateBaggerState (B.addToSeen t)

removeFromSeen :: MonadBagger m => OutputTx -> m ()
removeFromSeen t = updateBaggerState (B.removeFromSeen t)

getAddressNonceAndBalance :: MonadBagger m => Address -> m (Integer, Integer)
getAddressNonceAndBalance addr = (DD.addressStateNonce &&& DD.addressStateBalance) <$> getAddressState addr

addToPromotionCache :: MonadBagger m => OutputTx -> m ()
addToPromotionCache tx = updateBaggerState (B.addToPromotionCache tx)

purgeFromPending :: MonadBagger m => OutputTx -> m ()
purgeFromPending tx = updateBaggerState (B.purgeFromPending tx)

purgeFromQueued :: MonadBagger m => OutputTx -> m ()
purgeFromQueued tx = updateBaggerState (B.purgeFromQueued tx)

-- | Parent gas limit -> child gas limit
nextGasLimit :: Integer -> Integer
nextGasLimit g = g + q - (if d == 0 then 1 else 0) where (q,d) = g `quotRem` 1024

buildFromMiningCache :: MonadBagger m => m OutputBlock
buildFromMiningCache = do
    $logInfoS "Bagger.buildFromMiningCache" "pulling from mempool"
    state <- getBaggerState
    isPBFT <- isBlockstanbul
    (coinbaseAddr, nonce) <- peekPendingVote
    let cache        = B.miningCache state
    let uncles       = []
    let parentHash   = B.bestBlockSHA cache
    let parentHeader = B.bestBlockHeader cache
    let stateRoot    = B.lastExecutedStateRoot cache
    let txs          = (trrTransaction <$> B.lastExecutedTxs cache) ++ (snd <$> OMap.assocs (B.privateHashes cache))
    let parentNum    = DD.blockDataNumber parentHeader
    let parentDiff   = DD.blockDataDifficulty parentHeader
    let parentTS     = DD.blockDataTimestamp parentHeader
    let time         = B.startTimestamp cache
    let nextDiff     = BDB.nextDifficulty flags_difficultyBomb flags_testnet parentNum parentDiff parentTS time
    let nextBlockData = buildNextBlockHeader parentHeader parentHash uncles stateRoot txs time isPBFT coinbaseAddr nonce
    recordMaxBlockNumber "bagger_build" . DD.blockDataNumber $ nextBlockData
    rewardedBlockData <- buildRewardedBlockHeader nextBlockData uncles
    return OutputBlock { obOrigin = TO.Quarry
                       , obTotalDifficulty = parentDiff + nextDiff
                       , obBlockUncles = uncles
                       , obReceiptTransactions = txs
                       , obBlockData = rewardedBlockData
                       }

ourCoinbase :: Address
ourCoinbase = fromInteger . fst . head . readHex . Conf.coinbaseAddress . Conf.quarryConfig $ Conf.ethConf

buildNextBlockHeader :: DD.BlockData
                     -> SHA
                     -> [DD.BlockData]
                     -> StateRoot
                     -> [OutputTx]
                     -> UTCTime
                     -> Bool
                     -> Address
                     -> Word64
                     -> DD.BlockData
buildNextBlockHeader parentHeader parentHash uncles stateRoot txs time isPBFT coinbaseAddr nonce =
    let parentDiff = DD.blockDataDifficulty parentHeader
        parentNum  = DD.blockDataNumber parentHeader
        parentTS   = DD.blockDataTimestamp parentHeader
        nextDiff   = BDB.nextDifficulty flags_difficultyBomb flags_testnet parentNum parentDiff parentTS time
        in DD.BlockData { DD.blockDataParentHash       = parentHash
                        , DD.blockDataUnclesHash       = V.ommersVerificationValue uncles
                        -- TODO: when `isPBFT`, coinbase and nonce should be set from a queue of pending votes
                        , DD.blockDataCoinbase         = if isPBFT then coinbaseAddr else ourCoinbase
                        , DD.blockDataStateRoot        = stateRoot
                        , DD.blockDataTransactionsRoot = V.transactionsVerificationValue (otBaseTx <$> txs)
                        , DD.blockDataReceiptsRoot     = V.receiptsVerificationValue ()
                        , DD.blockDataLogBloom         = "0000000000000000000000000000000000000000000000000000000000000000"
                        , DD.blockDataDifficulty       = nextDiff
                        , DD.blockDataNumber           = parentNum + 1
                        , DD.blockDataGasLimit         = nextGasLimit $ DD.blockDataGasLimit parentHeader
                        , DD.blockDataGasUsed          = 0
                        , DD.blockDataTimestamp        = time
                        , DD.blockDataExtraData        = ""
                        , DD.blockDataMixHash          = if isPBFT then blockstanbulMixHash else SHA 0x0
                        , DD.blockDataNonce            = nonce
                        }

buildRewardedBlockHeader :: MonadBagger m => DD.BlockData -> [DD.BlockData] -> m DD.BlockData
buildRewardedBlockHeader bd uncles = do
  previousStateRoot <- getStateRoot
  $logInfoS "Bagger.buildRewardedBlockHeader" . T.pack $ "Baggin' with difficultyBomb = " ++ show flags_difficultyBomb
  $logInfoS "Bagger.buildRewardedBlockHeader" . T.pack $ "pre-reward :: (" ++ format (DD.blockDataStateRoot bd) ++ ")"
  rewardedStateRoot <- rewardCoinbases  (DD.blockDataStateRoot bd) (DD.blockDataCoinbase bd) uncles (DD.blockDataNumber bd)
  $logInfoS "Bagger.buildRewardedBlockHeader" . T.pack $ "post-reward :: (" ++ format rewardedStateRoot ++ ")"
  setStateDBStateRoot previousStateRoot
  return bd{DD.blockDataStateRoot = rewardedStateRoot}
