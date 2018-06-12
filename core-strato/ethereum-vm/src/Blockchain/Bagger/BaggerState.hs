{-# LANGUAGE BangPatterns #-}

module Blockchain.Bagger.BaggerState where

import           Control.Applicative                (Alternative, empty)

import qualified Data.Map.Strict                    as M
import           Data.Maybe                         (fromJust)
import           Data.Time.Clock

import           Blockchain.Bagger.Transactions
import           Blockchain.Bagger.TransactionList
import           Blockchain.Sequencer.Event         (OutputTx (..))

import           Blockchain.Data.Address
import qualified Blockchain.Data.DataDefs           as DD
import           Blockchain.ExtWord                 (Word256)
import qualified Blockchain.Data.TransactionDef     as TD
import           Blockchain.Database.MerklePatricia (StateRoot (..), blankStateRoot)
import           Blockchain.SHA

{-# NOINLINE upsertPT #-}

-- TODO: This is starting to want lenses

type ATL = M.Map Address TransactionList

data MiningCache = MiningCache { bestBlockSHA          :: SHA
                               , bestBlockHeader       :: DD.BlockData
                               , bestBlockTxHashes     :: [SHA]
                               , lastExecutedStateRoot :: StateRoot
                               , lastRewardedStateRoot :: StateRoot
                               , remainingGas          :: Integer
                               , lastExecutedTxs       :: [TxRunResult]
                               , promotedTransactions  :: [OutputTx]
                               , startTimestamp        :: UTCTime
                               } deriving (Show)

data Mempool = Mempool { miningCache :: !MiningCache
                       , pending :: ATL -- TXs that are going in the next block
                       , queued  :: ATL -- TXs that are lingering in the pool
                       }

data BaggerState = BaggerState { mempool               :: M.Map (Maybe Word256) Mempool
                               , seen                  :: M.Map SHA OutputTx
                               , calculateIntrinsicGas :: Integer -> OutputTx -> Integer -- fn that calculates intrinsic
                                                                                         -- gas cost for a given Tx and
                                                                                         -- block number
                               }

instance Show BaggerState where
    show b =    "BBBBB\n"
             ++ "B miningCache: " ++ show (unsafeGetPublic miningCache b) ++ "\n"
             ++ "B pending:     " ++ show (unsafeGetPublic pending b)     ++ "\n"
             ++ "B queued:      " ++ show (unsafeGetPublic queued b)      ++ "\n"
             ++ "B seen:        " ++ show (seen b)        ++ "\n"
             ++ "BBBBB"

fromMempool :: (Mempool -> a) -> Maybe Word256 -> BaggerState -> Maybe a
fromMempool f c b = f <$> M.lookup c (mempool b)

unsafeFromMempool :: (Mempool -> a) -> Maybe Word256 -> BaggerState -> a
unsafeFromMempool f c = maybe (error $ "unsafeFromMempool you loco!" ++ show c) id . fromMempool f c

getPublic :: (Mempool -> a) -> BaggerState -> Maybe a
getPublic f = fromMempool f Nothing

unsafeGetPublic :: (Mempool -> a) -> BaggerState -> a
unsafeGetPublic f = fromJust . getPublic f

updateMempool :: (Mempool -> Mempool) -> Maybe Word256 -> BaggerState -> BaggerState
updateMempool f c b = b{mempool = M.alter (Just . f . maybe defaultMempool id) c (mempool b)}

updatePublicMempool :: (Mempool -> Mempool) -> BaggerState -> BaggerState
updatePublicMempool f = updateMempool f Nothing

defaultBaggerState :: BaggerState
defaultBaggerState  = BaggerState { mempool               = M.insert Nothing defaultMempool M.empty
                                  , seen                  = M.empty
                                  , calculateIntrinsicGas = error "reached defaultBaggerState"
                                  }

defaultMempool :: Mempool
defaultMempool = Mempool { miningCache = defaultMiningCache
                         , pending     = M.empty
                         , queued      = M.empty
                         }

defaultMiningCache :: MiningCache
defaultMiningCache  = MiningCache { bestBlockSHA          = SHA 0
                                  , bestBlockHeader       = error "reached defaultMiningCache"
                                  , bestBlockTxHashes     = []
                                  , lastExecutedStateRoot = blankStateRoot
                                  , lastRewardedStateRoot = blankStateRoot
                                  , remainingGas          = 0
                                  , lastExecutedTxs       = []
                                  , promotedTransactions  = []
                                  , startTimestamp        = error "reached defaultMiningCache"
                                  }

addToATL :: OutputTx -> ATL -> (Maybe OutputTx, ATL)
addToATL t atl =
    case M.lookup signer atl of
        Nothing  -> (Nothing, M.insert signer (singletonTransactionList t) atl)
        Just txs -> let (oldTx, newTL) = insertTransaction t txs in (oldTx, M.insert signer newTL atl)
    where signer = otSigner t

modifyATL :: Alternative a => (TransactionList -> (a OutputTx, TransactionList)) -> Address -> ATL -> (a OutputTx, ATL)
modifyATL f address atl = case M.lookup address atl of
    Nothing -> (empty, atl)
    Just tl -> let (poppedTx, newTL) = f tl in
        if M.null newTL
            then (poppedTx, M.delete address atl)
            else (poppedTx, M.insert address newTL atl)

purgeFromATL :: Address -> Integer -> ATL -> ATL
purgeFromATL address nonce atl = case M.lookup address atl of
    Nothing -> atl
    Just tl -> let newTL = M.delete nonce tl in M.insert address newTL atl

calculateIntrinsicTxFee :: BaggerState -> (OutputTx -> Integer)
calculateIntrinsicTxFee bs t@OutputTx{otBaseTx = bt} =
    TD.transactionGasPrice bt * calculateIntrinsicGasAtNextBlock bs t

calculateIntrinsicGasAtNextBlock :: BaggerState -> OutputTx -> Integer
calculateIntrinsicGasAtNextBlock bs@BaggerState{ calculateIntrinsicGas = cig } tx@OutputTx{otBaseTx = otx} =
    let cid = TD.transactionChainId otx
     in cig (unsafeFromMempool (DD.blockDataNumber . bestBlockHeader . miningCache) cid bs) tx

addToPending :: OutputTx -> BaggerState -> (Maybe OutputTx, BaggerState)
addToPending t bs = let cid = TD.transactionChainId (otBaseTx t)
                        p = unsafeFromMempool pending cid bs
                        (oldTx, newATL) = addToATL t p
                     in (oldTx, updateMempool (\m -> m{pending = newATL}) cid bs)

addToQueued :: OutputTx -> BaggerState -> (Maybe OutputTx, BaggerState)
addToQueued t bs = let cid = TD.transactionChainId (otBaseTx t)
                       q = unsafeFromMempool queued cid bs
                       (oldTx, newATL) = addToATL t q
                    in (oldTx, updateMempool (\m -> m{queued = newATL}) cid bs)

addToSeen :: OutputTx -> BaggerState -> BaggerState
addToSeen t@OutputTx{otHash=sha} s@BaggerState{seen = seen'} = s { seen = M.insert sha t seen' }

removeFromSeen :: OutputTx -> BaggerState -> BaggerState
removeFromSeen OutputTx{otHash=sha} s@BaggerState{seen = seen'} = s { seen = M.delete sha seen' }

trimBelowNonceFromQueued :: Address -> Integer -> Maybe Word256 -> BaggerState -> ([OutputTx], BaggerState)
trimBelowNonceFromQueued a nonce cid bs =
    let q = unsafeFromMempool queued cid bs
        (oldTX, newATL) = modifyATL (trimBelowNonce nonce) a q
     in (oldTX, updateMempool (\m -> m{ queued = newATL }) cid bs)

trimBelowNonceFromPending :: Address -> Integer -> Maybe Word256 -> BaggerState -> ([OutputTx], BaggerState)
trimBelowNonceFromPending a nonce cid bs =
    let p = unsafeFromMempool pending cid bs
        (oldTx, newATL) = modifyATL (trimBelowNonce nonce) a p
     in (oldTx, updateMempool (\m -> m{ pending = newATL }) cid bs)

trimAboveCostFromQueued :: Address -> Integer -> Maybe Word256 -> BaggerState -> ([OutputTx], BaggerState)
trimAboveCostFromQueued a maxCost cid bs =
    let q = unsafeFromMempool queued cid bs
        (oldTX, newATL) = modifyATL (trimAboveCost maxCost (calculateIntrinsicTxFee bs)) a q
     in (oldTX, updateMempool (\m -> m{ queued = newATL }) cid bs)

trimAboveCostFromPending :: Address -> Integer -> Maybe Word256 -> BaggerState -> ([OutputTx], BaggerState)
trimAboveCostFromPending a maxCost cid bs =
    let p = unsafeFromMempool pending cid bs
        (oldTX, newATL) = modifyATL (trimAboveCost maxCost (calculateIntrinsicTxFee bs)) a p
     in (oldTX, updateMempool (\m -> m{ pending = newATL }) cid bs)

popSequentialFromQueued :: Address -> Integer -> Maybe Word256 -> BaggerState -> ([OutputTx], BaggerState)
popSequentialFromQueued a nonce cid bs =
    let q = unsafeFromMempool queued cid bs
        (popped, newATL) = modifyATL (popSequential nonce) a q
     in (popped, updateMempool (\m -> m{ queued = newATL }) cid bs)

popAllPending :: Maybe Word256 -> BaggerState -> ([OutputTx], BaggerState)
popAllPending cid bs = (popped, updateMempool (\m -> m{ pending = M.empty }) cid bs)
    where popped = concatMap toList $ M.elems p
          p = unsafeFromMempool pending cid bs

purgeFromQueued :: OutputTx -> BaggerState -> BaggerState
purgeFromQueued OutputTx{otSigner=sender, otBaseTx=tx} bs =
    updateMempool (\m -> m{ queued = newATL }) cid bs
      where newATL = purgeFromATL sender (TD.transactionNonce tx) q
            q = unsafeFromMempool queued cid bs
            cid = TD.transactionChainId tx

purgeFromPending :: OutputTx -> BaggerState -> BaggerState
purgeFromPending OutputTx{otSigner=sender, otBaseTx=tx} bs =
    updateMempool (\m -> m{ pending= newATL }) cid bs
      where newATL = purgeFromATL sender (TD.transactionNonce tx) p
            p = unsafeFromMempool pending cid bs
            cid = TD.transactionChainId tx


addToPromotionCache :: OutputTx -> BaggerState -> BaggerState
addToPromotionCache tx bs =
    let cid = TD.transactionChainId (otBaseTx tx)
        mc = unsafeFromMempool miningCache cid bs
        pt = promotedTransactions mc
     in updateMempool (\m -> m{ miningCache = mc { promotedTransactions = upsertPT tx pt }}) cid bs

upsertPT :: OutputTx -> [OutputTx] -> [OutputTx]
upsertPT tx@OutputTx{otSigner=addr, otBaseTx=bt} pt = ret
    where filtered = filter (not . (\t -> otSigner t == addr && nonce (otBaseTx t) == nonce bt)) pt
          nonce = TD.transactionNonce
          !ret = tx : filtered

