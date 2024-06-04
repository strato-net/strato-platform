{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Bagger.BaggerState where

import Blockchain.Bagger.TransactionList
import Blockchain.Bagger.Transactions
import Blockchain.Data.BlockHeader
import qualified Blockchain.Data.TransactionDef as TD
import Blockchain.Database.MerklePatricia (StateRoot (..), blankStateRoot)
import Blockchain.Sequencer.Event (OutputTx (..))
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Keccak256
import Control.Applicative (Alternative, empty)
import Control.DeepSeq
import qualified Data.DList as DL
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import Data.Time.Clock
import Data.Time.Clock.POSIX
import GHC.Generics

{-# NOINLINE upsertPT #-}

type ATL = M.Map Address TransactionList

data MiningCache = MiningCache
  { bestBlockSHA :: Keccak256,
    bestBlockHeader :: BlockHeader,
    bestBlockTxHashes :: [Keccak256],
    lastExecutedStateRoot :: StateRoot,
    remainingGas :: Integer,
    lastExecutedTxs :: [TxRunResult],
    promotedTransactions :: [OutputTx],
    privateHashes :: DL.DList OutputTx,
    startTimestamp :: UTCTime
  }
  deriving (Show, Generic)

instance NFData MiningCache

data BaggerState = BaggerState
  { miningCache :: !MiningCache,
    pending :: ATL, -- TXs that are going in the next block
    queued :: ATL, -- TXs that are lingering in the pool
    seen :: S.Set Keccak256,
    calculateIntrinsicGas :: Integer -> OutputTx -> Integer -- fn that calculates intrinsic
    -- gas cost for a given Tx and
    -- block number
  }
  deriving (Generic)

instance NFData BaggerState

instance Show BaggerState where
  show b =
    "BBBBB\n"
      ++ "B miningCache: "
      ++ show (miningCache b)
      ++ "\n"
      ++ "B pending:     "
      ++ show (pending b)
      ++ "\n"
      ++ "B queued:      "
      ++ show (queued b)
      ++ "\n"
      ++ "B seen:        "
      ++ show (seen b)
      ++ "\n"
      ++ "BBBBB"

defaultBaggerState :: BaggerState
defaultBaggerState =
  BaggerState
    { miningCache = defaultMiningCache,
      pending = M.empty,
      queued = M.empty,
      seen = S.empty,
      calculateIntrinsicGas = \_ _ -> 0xaaaaa
    }

defaultMiningCache :: MiningCache
defaultMiningCache =
  MiningCache
    { bestBlockSHA = unsafeCreateKeccak256FromWord256 0,
      bestBlockHeader =
        ( BlockHeader
            (unsafeCreateKeccak256FromWord256 0)
            (unsafeCreateKeccak256FromWord256 0)
            (Everyone False)
            blankStateRoot
            blankStateRoot
            blankStateRoot
            ""
            100
            100
            100
            100
            (posixSecondsToUTCTime 0)
            ""
            (unsafeCreateKeccak256FromWord256 30)
            137
        ),
      bestBlockTxHashes = [],
      lastExecutedStateRoot = blankStateRoot,
      remainingGas = 0,
      lastExecutedTxs = [],
      promotedTransactions = [],
      privateHashes = DL.empty,
      startTimestamp = posixSecondsToUTCTime 0
    }

addToATL :: OutputTx -> ATL -> (Maybe OutputTx, OutputTx, ATL)
addToATL t atl =
  case M.lookup signer atl of
    Nothing -> (Nothing, t, M.insert signer (singletonTransactionList t) atl)
    Just txs ->
      let (oldTx, newTx, newTL) = insertTransaction t txs
       in (oldTx, newTx, M.insert signer newTL atl)
  where
    signer = otSigner t

modifyATL :: Alternative a => (TransactionList -> (a OutputTx, TransactionList)) -> Address -> ATL -> (a OutputTx, ATL)
modifyATL f address atl = case M.lookup address atl of
  Nothing -> (empty, atl)
  Just tl ->
    let (poppedTx, newTL) = f tl
     in if M.null newTL
          then (poppedTx, M.delete address atl)
          else (poppedTx, M.insert address newTL atl)

purgeFromATL :: Address -> Integer -> ATL -> ATL
purgeFromATL address nonce' atl = case M.lookup address atl of
  Nothing -> atl
  Just tl -> let newTL = M.delete nonce' tl in M.insert address newTL atl

calculateIntrinsicTxFee :: BaggerState -> (OutputTx -> Integer)
calculateIntrinsicTxFee bs t@OutputTx {otBaseTx = bt} =
  TD.transactionGasPrice bt * calculateIntrinsicGasAtNextBlock bs t

calculateIntrinsicGasAtNextBlock :: BaggerState -> OutputTx -> Integer
calculateIntrinsicGasAtNextBlock BaggerState {miningCache = MiningCache {bestBlockHeader = bh}, calculateIntrinsicGas = cig} =
  cig (number bh + 1)

addToPending :: OutputTx -> BaggerState -> (Maybe OutputTx, OutputTx, BaggerState)
addToPending t s@BaggerState {pending = p} =
  let (oldTx, newTx, newATL) = addToATL t p
   in (oldTx, newTx, s {pending = newATL})

addToQueued :: OutputTx -> BaggerState -> (Maybe OutputTx, BaggerState)
addToQueued t s@BaggerState {queued = q} =
  let (oldTx, _, newATL) = addToATL t q
   in (oldTx, s {queued = newATL})

addToSeen :: OutputTx -> BaggerState -> BaggerState
addToSeen OutputTx {otHash = sha} s@BaggerState {seen = seen'} = s {seen = S.insert sha seen'}

removeFromSeen :: OutputTx -> BaggerState -> BaggerState
removeFromSeen OutputTx {otHash = sha} s@BaggerState {seen = seen'} = s {seen = S.delete sha seen'}

trimBelowNonceFromQueued :: Address -> Integer -> BaggerState -> ([OutputTx], BaggerState)
trimBelowNonceFromQueued a nonce' s@BaggerState {queued = q} =
  let (oldTX, newATL) = modifyATL (trimBelowNonce nonce') a q in (oldTX, s {queued = newATL})

trimBelowNonceFromPending :: Address -> Integer -> BaggerState -> ([OutputTx], BaggerState)
trimBelowNonceFromPending a nonce' s@BaggerState {pending = p} =
  let (oldTX, newATL) = modifyATL (trimBelowNonce nonce') a p in (oldTX, s {pending = newATL})

trimAboveCostFromQueued :: Address -> Integer -> BaggerState -> ([OutputTx], BaggerState)
trimAboveCostFromQueued a maxCost s@BaggerState {queued = q} =
  let (oldTX, newATL) = modifyATL (trimAboveCost maxCost (calculateIntrinsicTxFee s)) a q
   in (oldTX, s {queued = newATL})

trimAboveCostFromPending :: Address -> Integer -> BaggerState -> ([OutputTx], BaggerState)
trimAboveCostFromPending a maxCost s@BaggerState {pending = p} =
  let (oldTX, newATL) = modifyATL (trimAboveCost maxCost (calculateIntrinsicTxFee s)) a p
   in (oldTX, s {pending = newATL})

popSequentialFromQueued :: Address -> Integer -> BaggerState -> ([OutputTx], BaggerState)
popSequentialFromQueued a nonce' s@BaggerState {queued = q} =
  let (popped, newATL) = modifyATL (popSequential nonce') a q in (popped, s {queued = newATL})

popAllPending :: BaggerState -> ([OutputTx], BaggerState)
popAllPending s@BaggerState {pending = p} = (popped, s {pending = M.empty})
  where
    popped = concatMap toList $ M.elems p

purgeFromQueued :: OutputTx -> BaggerState -> BaggerState
purgeFromQueued OutputTx {otSigner = sender, otBaseTx = tx} s@BaggerState {queued = q} = s {queued = newATL}
  where
    newATL = purgeFromATL sender (TD.transactionNonce tx) q

purgeFromPending :: OutputTx -> BaggerState -> BaggerState
purgeFromPending OutputTx {otSigner = sender, otBaseTx = tx} s@BaggerState {pending = p} = s {pending = newATL}
  where
    newATL = purgeFromATL sender (TD.transactionNonce tx) p

addToPromotionCache :: OutputTx -> BaggerState -> BaggerState
addToPromotionCache tx s@BaggerState {miningCache = mc@MiningCache {promotedTransactions = pt}} =
  s {miningCache = mc {promotedTransactions = upsertPT tx pt}}

upsertPT :: OutputTx -> [OutputTx] -> [OutputTx]
upsertPT tx@OutputTx {otSigner = addr, otBaseTx = bt} pt = ret
  where
    filtered = filter (not . (\t -> otSigner t == addr && nonce' (otBaseTx t) <= nonce' bt)) pt
    nonce' = TD.transactionNonce
    !ret = tx : filtered
