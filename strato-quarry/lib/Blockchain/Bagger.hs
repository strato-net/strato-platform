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

data BaggerTxQueue = Validation | Pending | Queued deriving (Eq, Show)

data BaggerTxRejection = NonceTooLow    BaggerTxQueue Integer OutputTx -- integer is actual nonce
                       | BalanceTooLow  BaggerTxQueue Integer OutputTx -- integer is actual balance
                       | GasLimitTooLow BaggerTxQueue Integer OutputTx -- queue should probably only be Validation, integer is intrinsic gas
                       deriving Show

instance Format BaggerTxRejection where
    format (NonceTooLow    queue actual o@OutputTx{otHash=hash}) = "NonceTooLow at stage "    ++ show queue ++ "\n\tactual nonce "     ++ (show actual) ++ "\n\ttx hash " ++ (format hash) ++ "\n" ++ (format o)
    format (BalanceTooLow  queue actual o@OutputTx{otHash=hash}) = "BalanceTooLow at stage "  ++ show queue ++ "\n\tactual tx limit "  ++ (show actual) ++ "\n\ttx hash " ++ (format hash) ++ "\n" ++ (format o)
    format (GasLimitTooLow queue actual o@OutputTx{otHash=hash}) = "GasLimitTooLow at stage " ++ show queue ++ "\n\tactual gas limit " ++ (show actual) ++ "\n\ttx hash " ++ (format hash) ++ "\n" ++ (format o)

class (Monad m, MonadIO m, HasHashDB m, HasStateDB m, HasMemAddressStateDB m) => MonadBagger m where
    getBaggerState     :: m B.BaggerState
    putBaggerState     :: B.BaggerState -> m ()
    runFromStateRoot   :: StateRoot -> Integer -> DD.BlockData -> [OutputTx] -> m (Either RunAttemptError (StateRoot, Integer))
    rewardCoinbases    :: StateRoot -> Address -> [DD.BlockData] -> Integer -> m StateRoot -- miner coinbase -> known uncles -> this block number -> stateRoot
    txsDroppedCallback :: [BaggerTxRejection] -> m () -- called when a Tx is dropped from/rejected by the pool
    {-# MINIMAL getBaggerState, putBaggerState, runFromStateRoot, rewardCoinbases, txsDroppedCallback #-}

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
        let lastExecGuardLen = length [t | t  <- lastExec, otHash t `M.member` seen']
        let noCachedTxsCulled = lastExecLen == lastExecGuardLen
        -- liftIO $ traceIO $ (show lastExecLen) ++ " =?= " ++ (show lastExecGuardLen)
        if noCachedTxsCulled then do
            liftIO $ traceIO $ "noCachedTxsCulled = True"
            if (null $ B.promotedTransactions cache) then do
                    liftIO $ traceIO $ "null $ B.promotedTransactions cache = True"
                    !build <- buildFromMiningCache
                    return build
                else do
                    liftIO $ traceIO $ "null $ B.promotedTransactions cache = False"
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
            liftIO $ traceIO $ "noCachedTxsCulled = False"
            let sha    = B.bestBlockSHA cache
            let header = B.bestBlockHeader cache
            processNewBestBlock sha header
            !nb <- makeNewBlock
            return nb


    setCalculateIntrinsicGas :: (Integer -> OutputTx -> Integer) -> m ()
    setCalculateIntrinsicGas cig = putBaggerState =<< (\s -> s { B.calculateIntrinsicGas = cig }) <$> getBaggerState

logReady prefix address OutputTx{otHash=h, otBaseTx=t} = do
    liftIO $ traceIO $ ("\n+++\n" ++ prefix ++ " for address " ++ (format address) ++ ";\n tx was \nh=" ++ (format h) ++ "\nn=" ++ (show $ TD.transactionNonce t) ++ "\n+++\n")

logDiscard prefix address expectation OutputTx{otHash=h, otBaseTx=t} = do
    liftIO $ traceIO $ ("\n===\n" ++ prefix ++ " expected " ++ (show expectation) ++ " for address " ++ (format address) ++ ";\n tx was \nh=" ++ (format h) ++ "\nn=" ++ (show $ TD.transactionNonce t) ++ "\n===\n")

logDiscard' prefix address  OutputTx{otHash=h, otBaseTx=t} = do
    liftIO $ traceIO $ ("\n---\n" ++ prefix ++ " for address " ++ (format address) ++ ";\n tx was \nh=" ++ (format h) ++ "\nn=" ++ (show $ TD.transactionNonce t) ++ "\n---\n")

addToQueued :: MonadBagger m => OutputTx -> m ()
addToQueued t@OutputTx{otSigner = signer} =
    unlessM (wasSeen t) $ do
        validation <- (isValidForPool t)
        -- liftIO $ traceIO $ "validation :: " ++ show validation
        case validation of
            Left rejection -> do
                -- liftIO $ traceIO $ "rejection " ++ show rejection
                txsDroppedCallback [rejection]
            Right _ -> do
                -- liftIO $ traceIO "non-rejection "
                !(toDiscard, newState) <- B.addToQueued t <$> getBaggerState
                putBaggerState newState
                -- liftIO $ traceIO $ show newState
                forM_ toDiscard removeFromSeen
                forM_ toDiscard $ logDiscard' "addToQueued" signer
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
        forM_ discardedByNonce $ logDiscard "promoteExecutables Queued Nonce" address addressNonce

        let !(discardedByCost, state'') = B.trimAboveCostFromQueued address addressBalance state'
        putBaggerState state''
        forM_ discardedByCost removeFromSeen
        forM_ discardedByCost $ logDiscard "promoteExecutables Queued Balance" address addressBalance

        let !(readyToMine, state''') = B.popSequentialFromQueued address addressNonce state''
        putBaggerState state'''
        forM_ readyToMine $ logReady "promoteExecutables Ready-to-mine!" address

        -- todo callback per promotion call instead of per-address?
        let nonceDrops = (NonceTooLow Queued addressNonce)     <$> discardedByNonce
        let costDrops  = (BalanceTooLow Queued addressBalance) <$> discardedByCost
        txsDroppedCallback (nonceDrops ++ costDrops)
        forM_ readyToMine promoteTx

promoteTx :: MonadBagger m => OutputTx -> m ()
promoteTx tx@OutputTx{otSigner=signer} = do
    state <- getBaggerState
    let !(evicted, state') = B.addToPending tx state
    putBaggerState state'
    forM_ evicted removeFromSeen
    forM_ evicted $ logDiscard' "promoteTx" signer 
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
        forM_ discardedByNonce $ logDiscard "demoteUnexecutables Pending Nonce" address addressNonce

        let !(discardedByCost, state'') = B.trimAboveCostFromPending address addressBalance state'
        putBaggerState state''
        forM_ discardedByCost removeFromSeen
        forM_ discardedByCost $ logDiscard "demoteUnexecutables  Pending Balance" address addressBalance

        -- todo callback per demotion call instead of per-address?
        let nonceDrops = (NonceTooLow Queued addressNonce)     <$> discardedByNonce
        let costDrops  = (BalanceTooLow Queued addressBalance) <$> discardedByCost
        txsDroppedCallback (nonceDrops ++ costDrops)

        -- drop all existing pending transactions, and try to see if they're
        -- still valid to add to the (likely new) queued pool
        let !(remainingPending, state''') = B.popAllPending state''
        putBaggerState state'''
        forM_ remainingPending $ \t -> removeFromSeen t >> addToQueued t

wasSeen :: MonadBagger m => OutputTx -> m Bool
wasSeen OutputTx{otHash=sha} = do
    ret <- (M.member sha) . B.seen <$> getBaggerState
    -- liftIO $ traceIO $ "wasSeen " ++ (show sha) ++ " = " ++ (show ret)
    return ret

isValidForPool :: MonadBagger m => OutputTx -> m (Either BaggerTxRejection ())
isValidForPool t@OutputTx{otSigner=address, otBaseTx=bt} = do
    -- todo: is this everything that can be checked? be more pedantic and check for neg. balance, etc?
    state <- getBaggerState
    let intrinsicGas = B.calculateIntrinsicGasAtNextBlock state t
    let txGasLimit   = TD.transactionGasLimit bt
    let txNonce      = TD.transactionNonce bt
    let txFee        = B.calculateIntrinsicTxFee state t
    if intrinsicGas > txGasLimit
        then return . Left $ GasLimitTooLow Validation intrinsicGas t
        else do
            (addressNonce, addressBalance) <- getAddressNonceAndBalance address
            --liftIO $ putStrLn $ "V4P: " ++ (show tup) ++ " vs (" ++ show txNonce ++ ", " ++ show txFee ++ ")"
            if addressNonce > txNonce then
                return . Left $ NonceTooLow Validation addressNonce t
            else if addressBalance < txFee then
                return . Left $ BalanceTooLow Validation addressBalance t
            else
                return $ Right ()

addToSeen :: MonadBagger m => OutputTx -> m ()
addToSeen t@OutputTx{otHash=sha} = do
    -- liftIO $ traceIO $ "addToSeen " ++ show sha
    updateBaggerState (B.addToSeen t)

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
    rewardedStateRoot <- rewardCoinbases stateRoot ourCoinbase uncles (parentNum + 1)
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
