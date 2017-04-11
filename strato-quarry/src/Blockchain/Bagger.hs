{-# LANGUAGE OverloadedStrings, BangPatterns, TemplateHaskell #-}
{-# OPTIONS -fprof-auto -fprof-cafs #-}
module Blockchain.Bagger where

import Control.Monad.Extra
import Control.Monad.IO.Class
import Control.Monad.Logger
import Control.Arrow ((&&&)) -- yes. very yes.

import Data.Time.Clock
import qualified Data.Text as T
import Numeric (readHex)

import Blockchain.CoreFlags (flags_difficultyBomb, flags_testnet)
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.StateDB
import Blockchain.DB.HashDB

import Blockchain.Data.Address
import Blockchain.Database.MerklePatricia (StateRoot(..))
import Blockchain.SHA hiding (hash)
import Blockchain.Sequencer.Event (OutputTx(..), OutputBlock(..))
import qualified Blockchain.Data.BlockDB as BDB
import qualified Blockchain.Data.DataDefs as DD
import qualified Blockchain.Data.TransactionDef as TD
import qualified Blockchain.Data.TXOrigin as TO
import qualified Blockchain.Verification as V
import qualified Blockchain.EthConf as Conf
import qualified Blockchain.Bagger.BaggerState as B

import qualified Data.Map as M
import Blockchain.Format

data RunAttemptState = RunAttemptState { rasRanTxs    :: [OutputTx]
                                       , rasUnranTxs  :: [OutputTx]
                                       , rasStateRoot :: StateRoot
                                       , rasRemGas    :: Integer
                                       } deriving (Eq, Read, Show)

data RunAttemptError = CantFindStateRoot
                     | GasLimitReached [OutputTx] [OutputTx] StateRoot Integer    -- ran, unran, new stateroot, remgas
                     | RecoverableFailure TxRejection [OutputTx] [OutputTx] StateRoot Integer -- this means the culprit can be dropped from the pool and the block can continue
                     deriving (Eq, Read, Show)                                                -- same order of args

data BaggerTxQueue = Incoming | Pending | Queued deriving (Eq, Read, Show)

data TxRejection = NonceTooLow    BaggerStage BaggerTxQueue Integer OutputTx -- integers: needed nonce
                 | BalanceTooLow  BaggerStage BaggerTxQueue Integer Integer OutputTx -- integers: needed balance, actual balance
                 | GasLimitTooLow BaggerStage BaggerTxQueue Integer OutputTx -- queue should probably only be Validation, integer is intrinsic gas
                 | LessLucrative  BaggerStage BaggerTxQueue OutputTx OutputTx -- newTx, oldTx
                 deriving (Eq, Read, Show)

data BaggerStage = Insertion | Validation | Promotion | Demotion | Execution deriving (Read, Eq, Show)

instance Format TxRejection where
    format (NonceTooLow    stage queue actual o@OutputTx{otHash=hash}) =
        "NonceTooLow at stage "    ++ show stage ++ " in queue " ++ show queue ++
        "\n\tactual nonce "     ++ show actual ++
        "\n\ttx hash " ++ format hash ++
        "\n" ++ format o
    format (BalanceTooLow  stage queue needed actual o@OutputTx{otHash=hash}) =
        "BalanceTooLow at stage "  ++ show stage ++ " in queue " ++ show queue ++
        "\n\tneeded balance "  ++ show needed ++
        "\n\tavailable balance" ++ show actual ++
        "\n\ttx hash " ++ format hash ++
        "\n" ++ format o
    format (GasLimitTooLow stage queue actual o@OutputTx{otHash=hash}) =
        "GasLimitTooLow at stage " ++ show stage ++ " in queue " ++ show queue ++
        "\n\tactual gas limit " ++ show actual ++
        "\n\ttx hash " ++ format hash ++
        "\n" ++ format o
    format (LessLucrative stage queue superior inferior) =
            "LessLucrative at stage " ++ show stage ++ " in queue " ++ show queue ++
            "\n++++superior transaction:++++\n" ++ format superior ++
            "\n----inferior transaction:----\n" ++ format inferior

class (Monad m, MonadIO m, HasHashDB m, HasStateDB m, HasMemAddressStateDB m, MonadLogger m) => MonadBagger m where
    getBaggerState     :: m B.BaggerState
    putBaggerState     :: B.BaggerState -> m ()
    runFromStateRoot   :: StateRoot -> Integer -> DD.BlockData -> [OutputTx] -> m (Either RunAttemptError (StateRoot, Integer))
    rewardCoinbases    :: StateRoot -> Address -> [DD.BlockData] -> Integer -> m StateRoot -- miner coinbase -> known uncles -> this block number -> stateRoot
    txsDroppedCallback :: [TxRejection] -> [SHA] -> m () -- called when a Tx is dropped from/rejected by the pool
    {-# MINIMAL getBaggerState, putBaggerState, runFromStateRoot, rewardCoinbases, txsDroppedCallback #-}

    getCheckpointableState :: m (SHA, DD.BlockData, [SHA])
    getCheckpointableState = do
        state <- getBaggerState
        let miningCache = B.miningCache state
            bestSHA     = B.bestBlockSHA miningCache
            bestHeader  = B.bestBlockHeader miningCache
            txShas      = B.bestBlockTxHashes miningCache
        return (bestSHA, bestHeader, txShas)

    updateBaggerState :: (B.BaggerState -> B.BaggerState) -> m ()
    updateBaggerState f = putBaggerState =<< (f <$> getBaggerState)

    addTransactionsToMempool :: [OutputTx] -> m ()
    addTransactionsToMempool ts = do
        existingStateDbStateRoot <- getStateRoot
        stateRoot <- (B.lastExecutedStateRoot . B.miningCache) <$> getBaggerState
        setStateDBStateRoot stateRoot
        sequence_ (addToQueued Insertion <$> ts)
        promoteExecutables
        setStateDBStateRoot existingStateDbStateRoot

    processNewBestBlock :: SHA -> DD.BlockData -> [SHA] -> m ()
    processNewBestBlock blockHash bd txShas = do
        existingStateDbStateRoot <- getStateRoot
        let thisStateRoot = DD.blockDataStateRoot bd
        state <- getBaggerState
        time  <- liftIO getCurrentTime
        let newMiningCache = B.MiningCache { B.bestBlockSHA          = blockHash
                                           , B.bestBlockHeader       = bd
                                           , B.bestBlockTxHashes     = txShas
                                           , B.lastExecutedStateRoot = thisStateRoot
                                           , B.remainingGas          = nextGasLimit $ DD.blockDataGasLimit bd
                                           , B.lastExecutedTxs       = []
                                           , B.promotedTransactions  = []
                                           , B.startTimestamp        = time
                                           }
        putBaggerState $ state { B.miningCache = newMiningCache }
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
        let lastExecGuardLen = length [t | t  <- lastExec, otHash t `M.member` seen']
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
                    let lastSR          = B.lastExecutedStateRoot cache
                    let lastSHA         = B.bestBlockSHA cache
                    let lastHead        = B.bestBlockHeader cache
                    let promoted        = B.promotedTransactions cache
                    let time            = B.startTimestamp cache
                    let tempBlockHeader = buildNextBlockHeader lastHead lastSHA [] lastSR [] time
                    let remGas          = B.remainingGas cache
                    $logDebugS "Bagger.makeNewBlock" . T.pack $ "pre-incremental run :: (" ++ show remGas ++ ", " ++ format lastSR ++ ")"
                    !run <- runFromStateRoot lastSR remGas tempBlockHeader promoted
                    let (newSR, newGas, newExec, newUnexec) = case run of
                            Left (GasLimitReached rtx urtx nsr nbg) -> (nsr, nbg, lastExec ++ rtx, urtx)
                            Left e                                  -> error (show e)
                            Right (newSR', newGas')                 -> (newSR', newGas', lastExec ++ promoted, [])

                    let !newMiningCache = cache { B.lastExecutedStateRoot = newSR
                                                , B.remainingGas          = newGas
                                                , B.lastExecutedTxs       = newExec
                                                , B.promotedTransactions  = newUnexec
                                                }
                    $logDebugS "Bagger.makeNewBlock" . T.pack $ "post-incremental run :: (" ++ show newGas ++ ", " ++ format newSR ++ ")"
                    updateBaggerState (\s -> s { B.miningCache = newMiningCache })
                    setStateDBStateRoot existingStateDbStateRoot
                    !build <- buildFromMiningCache
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

logReady :: (MonadLogger m) => String -> Address -> OutputTx -> m()
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
    let txShas      = B.bestBlockTxHashes (B.miningCache preState)
        queued'     = M.keysSet (B.queued preState)
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
        state'''' <- getBaggerState
        -- todo callback per promotion call instead of per-address?
        let nonceDrops = NonceTooLow Promotion Queued addressNonce     <$> discardedByNonce
        let costDrops  = (\t -> BalanceTooLow Promotion Queued (B.calculateIntrinsicTxFee state'''' t) addressBalance t) <$> discardedByCost
        txsDroppedCallback (nonceDrops ++ costDrops) txShas
        forM_ readyToMine promoteTx

promoteTx :: MonadBagger m => OutputTx -> m ()
promoteTx tx@OutputTx{otSigner=signer} = do
    state <- getBaggerState
    let txShas = B.bestBlockTxHashes (B.miningCache state)
        !(evicted, state') = B.addToPending tx state
    putBaggerState state'
    forM_ evicted $ \e -> do
        removeFromSeen e
        logDiscard' "promoteTx" signer e
        txsDroppedCallback [LessLucrative Promotion Pending tx e] txShas
    addToPromotionCache tx

demoteUnexecutables :: MonadBagger m => m ()
demoteUnexecutables = do
    preState <- getBaggerState
    let txShas   = B.bestBlockTxHashes (B.miningCache preState)
        pending' = M.keysSet (B.pending preState)
    forM_ pending' $ \address -> do
        state <- getBaggerState
        (addressNonce, addressBalance) <- getAddressNonceAndBalance address

        let !(discardedByNonce, state') = B.trimBelowNonceFromPending address addressNonce state
        putBaggerState state'
        forM_ discardedByNonce removeFromSeen
        forM_ discardedByNonce $ logDiscard "demoteUnexecutables Pending Nonce" address addressNonce

        let !(discardedByCost, state'') = B.trimAboveCostFromPending address addressBalance state'
        putBaggerState state''
        forM_ discardedByCost removeFromSeen
        forM_ discardedByCost $ logDiscard "demoteUnexecutables  Pending Balance" address addressBalance
        state'''' <- getBaggerState
        -- todo callback per demotion call instead of per-address?
        let nonceDrops = NonceTooLow Demotion Queued addressNonce     <$> discardedByNonce
        let costDrops  = (\t -> BalanceTooLow Demotion Queued (B.calculateIntrinsicTxFee state'''' t) addressBalance t) <$> discardedByCost
        txsDroppedCallback (nonceDrops ++ costDrops) txShas

        -- drop all existing pending transactions, and try to see if they're
        -- still valid to add to the (likely new) queued pool
        let !(remainingPending, state''') = B.popAllPending state''
        putBaggerState state'''
        forM_ remainingPending $ \p -> do
            removeFromSeen p
            addToQueued Demotion p

wasSeen :: MonadBagger m => OutputTx -> m Bool
wasSeen OutputTx{otHash=sha} = do
    ret <- (M.member sha) . B.seen <$> getBaggerState
    -- $logDebugS "Bagger.wasSeen" . T.pack $ "wasSeen " ++ (show sha) ++ " = " ++ (show ret)
    return ret

isValidForPool :: MonadBagger m => OutputTx -> m (Either TxRejection ())
isValidForPool t@OutputTx{otSigner=address, otBaseTx=bt} = do
    -- todo: is this everything that can be checked? be more pedantic and check for neg. balance, etc?
    state <- getBaggerState
    let intrinsicGas = B.calculateIntrinsicGasAtNextBlock state t
    let txGasLimit   = TD.transactionGasLimit bt
    let txNonce      = TD.transactionNonce bt
    let txFee        = B.calculateIntrinsicTxFee state t
    if intrinsicGas > txGasLimit
        then return . Left $ GasLimitTooLow Validation Incoming intrinsicGas t
        else do
            (addressNonce, addressBalance) <- getAddressNonceAndBalance address
            --liftIO $ putStrLn $ "V4P: " ++ (show tup) ++ " vs (" ++ show txNonce ++ ", " ++ show txFee ++ ")"
            if addressNonce > txNonce then
                return . Left $ NonceTooLow Validation Incoming addressNonce t
            else if addressBalance < txFee then
                return . Left $ BalanceTooLow Validation Incoming txFee addressBalance t
            else
                return $ Right ()

addToSeen :: MonadBagger m => OutputTx -> m ()
addToSeen t = updateBaggerState (B.addToSeen t)

removeFromSeen :: MonadBagger m => OutputTx -> m ()
removeFromSeen t = updateBaggerState (B.removeFromSeen t)

getAddressNonceAndBalance :: MonadBagger m => Address -> m (Integer, Integer)
getAddressNonceAndBalance addr = (DD.addressStateNonce &&& DD.addressStateBalance) <$> getAddressState addr

addToPromotionCache :: MonadBagger m => OutputTx -> m ()
addToPromotionCache tx = updateBaggerState $ B.addToPromotionCache tx

-- | Parent gas limit -> child gas limit
nextGasLimit :: Integer -> Integer
nextGasLimit g = g + q - (if d == 0 then 1 else 0) where (q,d) = g `quotRem` 1024

buildFromMiningCache :: MonadBagger m => m OutputBlock
buildFromMiningCache = do
    cache <- B.miningCache <$> getBaggerState
    let uncles       = []
    let parentHash   = B.bestBlockSHA cache
    let parentHeader = B.bestBlockHeader cache
    let stateRoot    = B.lastExecutedStateRoot cache
    let txs          = B.lastExecutedTxs cache
    let parentNum    = DD.blockDataNumber parentHeader
    let parentDiff   = DD.blockDataDifficulty parentHeader
    let parentTS     = DD.blockDataTimestamp parentHeader
    let time         = B.startTimestamp cache
    let nextDiff     = BDB.nextDifficulty flags_difficultyBomb flags_testnet parentNum parentDiff parentTS time
    previousStateRoot <- getStateRoot
    $logInfoS "Bagger.buildFromMiningCache" . T.pack $ "Baggin' with difficultyBomb = " ++ show flags_difficultyBomb
    $logInfoS "Bagger.buildFromMiningCache" . T.pack $ "pre-reward :: (" ++ format stateRoot ++ ")"
    rewardedStateRoot <- rewardCoinbases stateRoot ourCoinbase uncles (parentNum + 1)
    $logInfoS "Bagger.buildFromMiningCache" . T.pack $ "post-reward :: (" ++ format rewardedStateRoot ++ ")"
    setStateDBStateRoot previousStateRoot
    return OutputBlock { obOrigin = TO.Quarry
                       , obTotalDifficulty = parentDiff + nextDiff
                       , obBlockUncles = uncles
                       , obReceiptTransactions = txs
                       , obBlockData = buildNextBlockHeader parentHeader parentHash uncles rewardedStateRoot txs time
                       }

ourCoinbase :: Address
ourCoinbase = fromInteger . fst . head . readHex . Conf.coinbaseAddress . Conf.quarryConfig $ Conf.ethConf

buildNextBlockHeader :: DD.BlockData
                     -> SHA
                     -> [DD.BlockData]
                     -> StateRoot
                     -> [OutputTx]
                     -> UTCTime
                     -> DD.BlockData
buildNextBlockHeader parentHeader parentHash uncles stateRoot txs time =
    let parentDiff = DD.blockDataDifficulty parentHeader
        parentNum  = DD.blockDataNumber parentHeader
        parentTS   = DD.blockDataTimestamp parentHeader
        nextDiff   = BDB.nextDifficulty flags_difficultyBomb flags_testnet parentNum parentDiff parentTS time
        in DD.BlockData { DD.blockDataParentHash       = parentHash
                        , DD.blockDataUnclesHash       = V.ommersVerificationValue uncles
                        , DD.blockDataCoinbase         = ourCoinbase
                        , DD.blockDataStateRoot        = stateRoot
                        , DD.blockDataTransactionsRoot = V.transactionsVerificationValue (otBaseTx <$> txs)
                        , DD.blockDataReceiptsRoot     = V.receiptsVerificationValue ()
                        , DD.blockDataLogBloom         = "0000000000000000000000000000000000000000000000000000000000000000"
                        , DD.blockDataDifficulty       = nextDiff
                        , DD.blockDataNumber           = parentNum + 1
                        , DD.blockDataGasLimit         = nextGasLimit $ DD.blockDataGasLimit parentHeader
                        , DD.blockDataGasUsed          = 0
                        , DD.blockDataTimestamp        = time
                        , DD.blockDataExtraData        = 0
                        , DD.blockDataMixHash          = SHA 0
                        , DD.blockDataNonce            = 5
                        }
