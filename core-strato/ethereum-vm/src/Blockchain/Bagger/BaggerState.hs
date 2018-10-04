{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Bagger.BaggerState where

import           Control.Applicative                (Alternative, empty)
import           Control.DeepSeq

import           Data.Map.Ordered                   (OMap)
import qualified Data.Map.Ordered                   as OMap
import qualified Data.Map.Strict                    as M
import           Data.Time.Clock
import           Data.Time.Clock.POSIX

import           GHC.Generics

import           Blockchain.Bagger.Transactions
import           Blockchain.Bagger.TransactionList
import           Blockchain.Sequencer.Event         (OutputTx (..))

import           Blockchain.Data.Address
import qualified Blockchain.Data.DataDefs           as DD
import qualified Blockchain.Data.TransactionDef     as TD
import           Blockchain.Database.MerklePatricia (StateRoot (..), blankStateRoot)
import           Blockchain.SHA

{-# NOINLINE upsertPT #-}

type ATL = M.Map Address TransactionList

instance (NFData a, NFData b) => NFData (OMap a b) where
  rnf m = OMap.assocs m `deepseq` ()

data MiningCache = MiningCache { bestBlockSHA          :: SHA
                               , bestBlockHeader       :: DD.BlockData
                               , bestBlockTxHashes     :: [SHA]
                               , lastExecutedStateRoot :: StateRoot
                               , lastRewardedStateRoot :: StateRoot
                               , remainingGas          :: Integer
                               , lastExecutedTxs       :: [TxRunResult]
                               , promotedTransactions  :: [OutputTx]
                               , privateHashes         :: OMap SHA OutputTx
                               , startTimestamp        :: UTCTime
                               } deriving (Show, Generic)

instance NFData MiningCache

data BaggerState = BaggerState { miningCache           :: !MiningCache
                               , pending               :: ATL -- TXs that are going in the next block
                               , queued                :: ATL -- TXs that are lingering in the pool
                               , seen                  :: M.Map SHA OutputTx
                               , calculateIntrinsicGas :: Integer -> OutputTx -> Integer -- fn that calculates intrinsic
                                                                                         -- gas cost for a given Tx and
                                                                                         -- block number
                               } deriving (Generic)

instance NFData BaggerState

instance Show BaggerState where
    show b =    "BBBBB\n"
             ++ "B miningCache: " ++ show (miningCache b) ++ "\n"
             ++ "B pending:     " ++ show (pending b)     ++ "\n"
             ++ "B queued:      " ++ show (queued b)      ++ "\n"
             ++ "B seen:        " ++ show (seen b)        ++ "\n"
             ++ "BBBBB"

defaultBaggerState :: BaggerState
defaultBaggerState  = BaggerState { miningCache           = defaultMiningCache
                                  , pending               = M.empty
                                  , queued                = M.empty
                                  , seen                  = M.empty
                                  , calculateIntrinsicGas = \_ _ -> 0xaaaaa
                                  }

defaultMiningCache :: MiningCache
defaultMiningCache  = MiningCache { bestBlockSHA          = SHA 0
                                  , bestBlockHeader       = (DD.BlockData
                                      (SHA 0) (SHA 0) (Address 0x7777)
                                      blankStateRoot blankStateRoot blankStateRoot
                                      "" 100 100 100 100
                                      (posixSecondsToUTCTime 0)
                                      "" 137 (SHA 30))

                                  , bestBlockTxHashes     = []
                                  , lastExecutedStateRoot = blankStateRoot
                                  , lastRewardedStateRoot = blankStateRoot
                                  , remainingGas          = 0
                                  , lastExecutedTxs       = []
                                  , promotedTransactions  = []
                                  , privateHashes         = OMap.empty
                                  , startTimestamp        = posixSecondsToUTCTime 0
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
calculateIntrinsicGasAtNextBlock BaggerState{ miningCache = MiningCache { bestBlockHeader = bh }, calculateIntrinsicGas = cig } =
    cig (DD.blockDataNumber bh + 1)

addToPending :: OutputTx -> BaggerState -> (Maybe OutputTx, BaggerState)
addToPending t s@BaggerState{pending = p} = let (oldTx, newATL) = addToATL t p in (oldTx, s { pending = newATL })

addToQueued :: OutputTx -> BaggerState -> (Maybe OutputTx, BaggerState)
addToQueued t s@BaggerState{queued = q} = let (oldTx, newATL) = addToATL t q in (oldTx, s { queued = newATL })

addToSeen :: OutputTx -> BaggerState -> BaggerState
addToSeen t@OutputTx{otHash=sha} s@BaggerState{seen = seen'} = s { seen = M.insert sha t seen' }

removeFromSeen :: OutputTx -> BaggerState -> BaggerState
removeFromSeen OutputTx{otHash=sha} s@BaggerState{seen = seen'} = s { seen = M.delete sha seen' }

trimBelowNonceFromQueued :: Address -> Integer -> BaggerState -> ([OutputTx], BaggerState)
trimBelowNonceFromQueued a nonce s@BaggerState{queued = q} =
    let (oldTX, newATL) = modifyATL (trimBelowNonce nonce) a q in (oldTX, s {queued = newATL })

trimBelowNonceFromPending :: Address -> Integer -> BaggerState -> ([OutputTx], BaggerState)
trimBelowNonceFromPending a nonce s@BaggerState{pending = p} =
    let (oldTX, newATL) = modifyATL (trimBelowNonce nonce) a p in (oldTX, s { pending = newATL })

trimAboveCostFromQueued :: Address -> Integer -> BaggerState -> ([OutputTx], BaggerState)
trimAboveCostFromQueued a maxCost s@BaggerState{queued = q} =
    let (oldTX, newATL) = modifyATL (trimAboveCost maxCost (calculateIntrinsicTxFee s)) a q in
        (oldTX, s { queued = newATL })

trimAboveCostFromPending :: Address -> Integer -> BaggerState -> ([OutputTx], BaggerState)
trimAboveCostFromPending a maxCost s@BaggerState{pending = p} =
    let (oldTX, newATL) = modifyATL (trimAboveCost maxCost (calculateIntrinsicTxFee s)) a p in
        (oldTX, s { pending = newATL })

popSequentialFromQueued :: Address -> Integer -> BaggerState -> ([OutputTx], BaggerState)
popSequentialFromQueued a nonce s@BaggerState{queued = q} =
    let (popped, newATL) = modifyATL (popSequential nonce) a q in (popped, s { queued = newATL })

popAllPending :: BaggerState -> ([OutputTx], BaggerState)
popAllPending s@BaggerState{pending = p} = (popped, s { pending = M.empty })
    where popped = concatMap toList $ M.elems p

purgeFromQueued :: OutputTx -> BaggerState -> BaggerState
purgeFromQueued OutputTx{otSigner=sender, otBaseTx=tx} s@BaggerState{queued = q} = s { queued = newATL }
    where newATL = purgeFromATL sender (TD.transactionNonce tx) q

purgeFromPending :: OutputTx -> BaggerState -> BaggerState
purgeFromPending OutputTx{otSigner=sender, otBaseTx=tx} s@BaggerState{pending = p} = s { pending = newATL }
    where newATL = purgeFromATL sender (TD.transactionNonce tx) p

addToPromotionCache :: OutputTx -> BaggerState -> BaggerState
addToPromotionCache tx s@BaggerState{ miningCache = mc@MiningCache{ promotedTransactions = pt } } =
    s { miningCache = mc { promotedTransactions = upsertPT tx pt } }

upsertPT :: OutputTx -> [OutputTx] -> [OutputTx]
upsertPT tx@OutputTx{otSigner=addr, otBaseTx=bt} pt = ret
    where filtered = filter (not . (\t -> otSigner t == addr && nonce (otBaseTx t) == nonce bt)) pt
          nonce = TD.transactionNonce
          !ret = tx : filtered

