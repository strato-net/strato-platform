{-# LANGUAGE OverloadedStrings, BangPatterns #-}
{-# OPTIONS -fprof-auto -fprof-cafs #-}
module Blockchain.Bagger where

import Control.Monad.Extra
import Control.Monad.IO.Class

import Data.Time.Clock
import Data.Maybe (isJust, fromJust)
import Numeric (readHex)

import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.StateDB
import Blockchain.DB.HashDB

import Blockchain.Data.Address
import Blockchain.Database.MerklePatricia (StateRoot(..))
import Blockchain.SHA
import Blockchain.Sequencer.Event (OutputTx(..), OutputBlock(..), outputBlockHash)
import qualified Blockchain.Data.BlockDB as BDB
import qualified Blockchain.Data.DataDefs as DD
import qualified Blockchain.Data.TransactionDef as TD
import qualified Blockchain.Data.TXOrigin as TO
import qualified Blockchain.Verification as V
import qualified Blockchain.EthConf as Conf

import qualified Blockchain.Bagger.BaggerState as B
import Blockchain.Bagger.TransactionList

import qualified Data.Map as M
import qualified Data.Set as S
import Blockchain.Format

import Debug.Trace (traceIO, traceShow)


data RunAttemptError = CantFindStateRoot
                     | GasLimitReached [OutputTx] [OutputTx] StateRoot Integer -- ran, unran, new stateroot, remgas
                     deriving Show

class (Monad m, MonadIO m, HasHashDB m, HasStateDB m, HasMemAddressStateDB m) => MonadBagger m where
    getBaggerState   :: m B.BaggerState
    putBaggerState   :: B.BaggerState -> m ()
    runFromStateRoot :: StateRoot -> Integer -> DD.BlockData -> [OutputTx] -> m (Either RunAttemptError (StateRoot, Integer))
    rewardCoinbases  :: StateRoot -> Address -> [Address] -> m StateRoot -- miner coinbase -> uncle coinbases -> stateRoot
    {-# MINIMAL getBaggerState, putBaggerState, runFromStateRoot, rewardCoinbases #-}

    updateBaggerState :: (B.BaggerState -> B.BaggerState) -> m ()
    updateBaggerState f = putBaggerState =<< (f <$> getBaggerState)

    addTransactionsToMempool :: [OutputTx] -> m ()
    addTransactionsToMempool ts = do
        existingStateDbStateRoot <- getStateRoot
        stateRoot <- (B.lastExecutedStateRoot . B.miningCache) <$> getBaggerState
        setStateDBStateRoot stateRoot
        sequence_ (addToQueued <$> ts)
        promoteExecutables
        setStateDBStateRoot existingStateDbStateRoot

    processNewBestBlock :: SHA -> DD.BlockData -> m ()
    processNewBestBlock blockHash bd = do
        existingStateDbStateRoot <- getStateRoot
        let thisStateRoot = DD.blockDataStateRoot bd
        state <- getBaggerState
        time  <- liftIO $ getCurrentTime
        let oldCache       = B.miningCache state
        let newMiningCache = B.MiningCache { B.bestBlockSHA          = blockHash
                                           , B.bestBlockHeader       = bd
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
        let noCachedTxsCulled = lastExecLen == length [t | t <- lastExec, otHash t `M.member` seen']
        if noCachedTxsCulled then
            if (null $ B.promotedTransactions cache) then do
                    !build <- buildFromMiningCache
                    return build
                else do
                    existingStateDbStateRoot <- getStateRoot
                    let lastSR          = B.lastExecutedStateRoot cache
                    let lastSHA         = B.bestBlockSHA cache
                    let lastHead        = B.bestBlockHeader cache
                    let promoted        = B.promotedTransactions cache
                    let time            = B.startTimestamp cache
                    let tempBlockHeader = buildNextBlockHeader lastHead lastSHA [] lastSR [] time
                    let remGas          = B.remainingGas cache
                    liftIO $ traceIO $ "pre-incremental run :: (" ++ show remGas ++ ", " ++ format lastSR ++ ")"
                    !run <- runFromStateRoot lastSR remGas tempBlockHeader promoted
                    let (newSR, newGas, newExec, newUnexec) = case run of
                            Left (GasLimitReached rtx urtx nsr nbg) -> (nsr, nbg, lastExec ++ rtx, urtx)
                            Left CantFindStateRoot                  -> error $ "Cant find StateRoot " ++ show lastSR
                            Right (newSR, newGas)                   -> (newSR, newGas, lastExec ++ promoted, [])

                    let !newMiningCache = cache { B.lastExecutedStateRoot = newSR
                                                , B.remainingGas          = newGas
                                                , B.lastExecutedTxs       = newExec
                                                , B.promotedTransactions  = newUnexec
                                                }
                    liftIO $ traceIO $ "post-incremental run :: (" ++ show newGas ++ ", " ++ format newSR ++ ")"
                    updateBaggerState (\s -> s { B.miningCache = newMiningCache })
                    setStateDBStateRoot existingStateDbStateRoot
                    !build <- buildFromMiningCache
                    return build
        else do -- some transactions which were cached have been evicted, need to recalculate entire block cache
            let sha    = B.bestBlockSHA cache
            let header = B.bestBlockHeader cache
            processNewBestBlock sha header
            !nb <- makeNewBlock
            return nb


    setCalculateIntrinsicGas :: (Integer -> OutputTx -> Integer) -> m ()
    setCalculateIntrinsicGas cig = putBaggerState =<< (\s -> s { B.calculateIntrinsicGas = cig }) <$> getBaggerState

addToQueued :: MonadBagger m => OutputTx -> m ()
addToQueued t@OutputTx{otSigner = signer} = unlessM (wasSeen t) $
                    whenM (isValidForPool t) $ do
                        !(toDiscard, newState) <- B.addToQueued t <$> getBaggerState
                        putBaggerState newState
                        forM_ toDiscard removeFromSeen
                        addToSeen t

promoteExecutables :: MonadBagger m => m ()
promoteExecutables = do
    state <- getBaggerState
    let queued' = M.keysSet $ B.queued state
    forM_ queued' $ \address -> do
        (addressNonce, addressBalance) <- getAddressNonceAndBalance address

        let !(discardedByNonce, state') = B.trimBelowNonceFromQueued address addressNonce state
        putBaggerState state'
        forM_ discardedByNonce removeFromSeen

        let !(discardedByCost, state'') = B.trimAboveCostFromQueued address addressBalance state'
        putBaggerState state''
        forM_ discardedByCost removeFromSeen

        let !(readyToMine, state''') = B.popSequentialFromQueued address addressNonce state''
        putBaggerState state'''
        forM_ readyToMine promoteTx

promoteTx :: MonadBagger m => OutputTx -> m ()
promoteTx tx = do
    state <- getBaggerState
    let !(evicted, state') = B.addToPending tx state
    putBaggerState state'
    forM_ evicted removeFromSeen
    addToPromotionCache tx

demoteUnexecutables :: MonadBagger m => m ()
demoteUnexecutables = do
    state <- getBaggerState
    let pending' = M.keysSet $ B.pending state
    forM_ pending' $ \address -> do
        (addressNonce, addressBalance) <- getAddressNonceAndBalance address

        let !(discardedByNonce, state') = B.trimBelowNonceFromPending address addressNonce state
        putBaggerState state'
        forM_ discardedByNonce removeFromSeen

        let !(discardedByCost, state'') = B.trimAboveCostFromPending address addressBalance state'
        putBaggerState state''
        forM_ discardedByCost removeFromSeen

        -- drop all existing pending transactions, and try to see if they're
        -- still valid to add to the (likely new) queued pool
        let !(remainingPending, state''') = B.popAllPending state''
        putBaggerState state'''
        forM_ remainingPending $ \t -> removeFromSeen t >> addToQueued t

wasSeen :: MonadBagger m => OutputTx -> m Bool
wasSeen OutputTx{otHash=sha} = (M.member sha) . B.seen <$> getBaggerState

isValidForPool :: MonadBagger m => OutputTx -> m Bool
isValidForPool t@OutputTx{otSigner=address, otBaseTx=bt} = do
    -- todo: is this everything that can be checked? be more pedantic and check for neg. balance, etc?
    state <- getBaggerState
    let intrinsicGas = B.calculateIntrinsicGasAtNextBlock state t
    let txGasLimit   = TD.transactionGasLimit bt
    let txNonce      = TD.transactionNonce bt
    let txFee        = B.calculateIntrinsicTxFee state t
    if intrinsicGas > txGasLimit
        then return False
        else do
            (addressNonce, addressBalance) <- getAddressNonceAndBalance address
            --liftIO $ putStrLn $ "V4P: " ++ (show tup) ++ " vs (" ++ show txNonce ++ ", " ++ show txFee ++ ")"
            return $ (addressNonce <= txNonce) && (addressBalance >= txFee)

addToSeen :: MonadBagger m => OutputTx -> m ()
addToSeen t = updateBaggerState (B.addToSeen t)

removeFromSeen :: MonadBagger m => OutputTx -> m ()
removeFromSeen t = updateBaggerState (B.removeFromSeen t)

getAddressNonceAndBalance :: MonadBagger m => Address -> m (Integer, Integer)
getAddressNonceAndBalance addr = (\aS -> (DD.addressStateNonce aS, DD.addressStateBalance aS)) <$> getAddressState addr

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
    let nextDiff     = BDB.nextDifficulty False parentNum parentDiff parentTS time
    previousStateRoot <- getStateRoot
    liftIO $ traceIO $ "pre-reward :: (" ++ format stateRoot ++ ")"
    rewardedStateRoot <- rewardCoinbases stateRoot ourCoinbase []
    liftIO $ traceIO $ "post-reward :: (" ++ format rewardedStateRoot ++ ")"
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
        nextDiff   = BDB.nextDifficulty False parentNum parentDiff parentTS time
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
