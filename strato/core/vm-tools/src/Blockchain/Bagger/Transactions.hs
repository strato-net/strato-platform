{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE RecordWildCards #-}

module Blockchain.Bagger.Transactions where

import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.SolidStorageDB (HasSolidStorageDB, getSolidStorageKeyVal')
import Blockchain.Data.ExecResults
import Blockchain.Data.Receipt
import Blockchain.Data.TXOrigin
import qualified Blockchain.Data.TransactionDef as TD
import Blockchain.Data.TransactionResultStatus
import Blockchain.Strato.Model.StateRoot (StateRoot (..))
import Blockchain.Model.WrappedBlock (OutputTx (..))
import Blockchain.Strato.Model.Address
import SolidVM.Model.Delta
import SolidVM.Model.Event
import SolidVM.Model.Storable (BasicValue (..), StoragePath (..), StoragePathPiece (..))
import Blockchain.Strato.Model.Keccak256 hiding (hash)
import qualified Blockchain.Stream.Action as Action
import Control.DeepSeq
import Control.Lens.Setter (set)
import Control.Monad.IO.Class (MonadIO)
import qualified Data.ByteString as B
import Data.Maybe (catMaybes)
import qualified Data.Map as M
import Data.List (foldl')
import Data.Time.Clock
import GHC.Generics
import SolidVM.Model.TypedArg (valueToTypedArg)
import Text.Format

data TxRunResult = TxRunResult
  { trrTransaction :: OutputTx,
    trrResult :: Either TransactionFailureCause ExecResults,
    trrTime :: NominalDiffTime,
    trrBeforeMap :: M.Map Address AddressStateModification,
    trrAfterMap :: M.Map Address AddressStateModification,
    trrNewAddresses :: [Address]
  }
  deriving (Show, Eq, Generic)

-- When we use a cached TxRunResult, the blockHash does not account for consensus values added.
rewriteBlockHash :: Keccak256 -> TxRunResult -> TxRunResult
rewriteBlockHash hsh (TxRunResult otx res t before after new) =
  TxRunResult otx {otOrigin = BlockHash hsh} res' t before after new
  where
    res' = case res of
      Left {} -> res
      Right er@ExecResults {erAction = mAction} -> Right er {erAction = set Action.blockHash hsh <$> mAction}

instance NFData TxRunResult

data TransactionFailureCause
  = TFInsufficientFunds Integer Integer OutputTx -- txCost, accountBalance
  | TFIntrinsicGasExceedsTxLimit Integer Integer OutputTx -- intrinsicGas, txGasLimit
  | TFBlockGasLimitExceeded Integer Integer OutputTx -- neededGas, actualGas
  | TFNonceMismatch Integer Integer OutputTx -- expectedNonce, actualNonce
  | TFTXSizeLimitExceeded Integer Integer OutputTx -- txSizeLimit, actualSize
  | TFIncorrectChainId Integer OutputTx
  | TFInvalidEnvelope String OutputTx -- why
  | TFFeeBoundExceeded Integer Integer OutputTx -- quotedFee, signedBound
  deriving (Eq, Read, Show, Generic)

instance NFData TransactionFailureCause

data RunAttemptState = RunAttemptState
  { rasRanTxs :: [TxRunResult],
    rasUnranTxs :: [OutputTx],
    rasStateRoot :: StateRoot,
    rasRemGas :: Integer
  }
  deriving (Show)

data RunAttemptError
  = CantFindStateRoot
  | GasLimitReached [TxRunResult] [OutputTx] StateRoot Integer -- ran, unran, new stateroot, remgas
  | RecoverableFailure TxRejection [TxRunResult] [OutputTx] StateRoot Integer -- this means the culprit can be dropped from the pool and the block can continue
  deriving (Show) -- same order of args

data BaggerTxQueue = Incoming | Pending | Queued deriving (Eq, Read, Show)

data TxRejection
  = NonceTooLow BaggerStage BaggerTxQueue Integer OutputTx -- integers: needed nonce
  | BalanceTooLow BaggerStage BaggerTxQueue Integer Integer OutputTx -- integers: needed balance, actual balance
  | GasLimitTooLow BaggerStage BaggerTxQueue Integer Integer OutputTx -- queue should probably only be Validation, integer is intrinsic gas
  | LessLucrative BaggerStage BaggerTxQueue OutputTx OutputTx -- newTx, oldTx
  | TXSizeLimitExceeded BaggerStage BaggerTxQueue Integer Integer OutputTx
  | ChainIdMismatch BaggerStage BaggerTxQueue Integer OutputTx
  | AdminFlushed BaggerStage BaggerTxQueue FlushScope OutputTx
  | InvalidEnvelope BaggerStage BaggerTxQueue String OutputTx -- why
  | FeeBoundExceeded BaggerStage BaggerTxQueue Integer Integer OutputTx -- quotedFee, signedBound
  deriving (Eq, Read, Show)

rejectedTx :: TxRejection -> OutputTx
rejectedTx (NonceTooLow _ _ _ t) = t
rejectedTx (BalanceTooLow _ _ _ _ t) = t
rejectedTx (GasLimitTooLow _ _ _ _ t) = t
rejectedTx (LessLucrative _ _ _ t) = t
rejectedTx (TXSizeLimitExceeded _ _ _ _ t) = t
rejectedTx (ChainIdMismatch _ _ _ t) = t
rejectedTx (AdminFlushed _ _ _ t) = t
rejectedTx (InvalidEnvelope _ _ _ t) = t
rejectedTx (FeeBoundExceeded _ _ _ _ t) = t

data BaggerStage = Insertion | Validation | Promotion | Demotion | Execution deriving (Read, Eq, Show)

data FlushScope = FlushPending | FlushQueued | FlushAll deriving (Read, Eq, Show)

instance Format TxRejection where
  format (NonceTooLow stage queue actual o@OutputTx {otHash = hash}) =
    "NonceTooLow at stage " ++ show stage ++ " in queue " ++ show queue
      ++ "\n\tactual nonce "
      ++ show actual
      ++ "\n\ttx hash "
      ++ format hash
      ++ "\n"
      ++ format o
  format (BalanceTooLow stage queue needed actual o@OutputTx {otHash = hash}) =
    "BalanceTooLow at stage " ++ show stage ++ " in queue " ++ show queue
      ++ "\n\tneeded balance "
      ++ show needed
      ++ "\n\tavailable balance "
      ++ show actual
      ++ "\n\ttx hash "
      ++ format hash
      ++ "\n"
      ++ format o
  format (GasLimitTooLow stage queue actual limit o@OutputTx {otHash = hash}) =
    "GasLimitTooLow at stage " ++ show stage ++ " in queue " ++ show queue
      ++ "\n\tactual gas limit "
      ++ show actual
      ++ "\n\ttransaction gas limit "
      ++ show limit
      ++ "\n\ttx hash "
      ++ format hash
      ++ "\n"
      ++ format o
  format (LessLucrative stage queue superior inferior) =
    "LessLucrative at stage " ++ show stage ++ " in queue " ++ show queue
      ++ "\n++++superior transaction:++++\n"
      ++ format superior
      ++ "\n----inferior transaction:----\n"
      ++ format inferior
  format (TXSizeLimitExceeded stage queue actual limit o@OutputTx {otHash = hash}) =
    "TXSizeLimitExceeded at stage " ++ show stage ++ " in queue " ++ show queue
      ++ "\n\tactual txSize "
      ++ show actual
      ++ "\n\ttxSize limit "
      ++ show limit
      ++ "\n\ttx hash "
      ++ format hash
      ++ "\n"
      ++ format o
  format (ChainIdMismatch stage queue expected tx) =
    "Incorrect chain ID at stage " ++ show stage ++ " in queue " ++ show queue
      ++ ": expected " ++ show expected ++ ", actual " ++ show (TD.chainId $ otBaseTx tx)
  format (AdminFlushed stage queue scope o@OutputTx {otHash = hash}) =
    "AdminFlushed at stage " ++ show stage ++ " in queue " ++ show queue
      ++ " with scope " ++ show scope
      ++ "\n\ttx hash "
      ++ format hash
      ++ "\n"
      ++ format o
  format (InvalidEnvelope stage queue why OutputTx {otHash = hash}) =
    "Invalid envelope at stage " ++ show stage ++ " in queue " ++ show queue
      ++ ": " ++ why ++ "\n\ttx hash " ++ format hash
  format (FeeBoundExceeded stage queue quote bound OutputTx {otHash = hash}) =
    "Fee bound exceeded at stage " ++ show stage ++ " in queue " ++ show queue
      ++ ": quoted fee " ++ show quote ++ " > signed bound " ++ show bound ++ "\n\ttx hash " ++ format hash

txRejectionToAPIFailureCause :: TxRejection -> TransactionResultStatus
txRejectionToAPIFailureCause (NonceTooLow stage queue needed tx) =
  Failure (show stage) (Just $ show queue) IncorrectNonce (Just needed) (Just . TD.nonce $ otBaseTx tx) Nothing
txRejectionToAPIFailureCause (BalanceTooLow stage queue needed actual _) =
  Failure (show stage) (Just $ show queue) Blockchain.Data.TransactionResultStatus.InsufficientFunds (Just needed) (Just actual) Nothing
txRejectionToAPIFailureCause (GasLimitTooLow stage queue needed limit _) =
  Failure (show stage) (Just $ show queue) IntrinsicGasExceedsLimit (Just needed) (Just limit) Nothing
txRejectionToAPIFailureCause (LessLucrative stage queue newTx _) =
  Failure (show stage) (Just $ show queue) TrumpedByMoreLucrative Nothing Nothing (Just $ "trumped by " ++ formatKeccak256WithoutColor (otHash newTx))
txRejectionToAPIFailureCause (TXSizeLimitExceeded stage queue actual limit _) =
  Failure (show stage) (Just $ show queue) Blockchain.Data.TransactionResultStatus.TXSizeLimitError (Just limit) (Just actual) (Just $ "The TX size is " ++ show actual ++ " but the limit is " ++ show limit)
txRejectionToAPIFailureCause (ChainIdMismatch stage queue expected tx) =
  Failure (show stage) (Just $ show queue) IncorrectChainId (Just expected) (TD.chainId $ otBaseTx tx) (Just "A matching signed chain ID is required")
txRejectionToAPIFailureCause (AdminFlushed stage queue scope t) =
  Failure (show stage) (Just $ show queue) Blockchain.Data.TransactionResultStatus.AdminFlushedError Nothing Nothing (Just $ "The transaction " ++ show (otHash t) ++ " was administratively flushed from mempool with scope " ++ show scope)
txRejectionToAPIFailureCause (InvalidEnvelope stage queue why _) =
  Failure (show stage) (Just $ show queue) Blockchain.Data.TransactionResultStatus.InvalidEnvelopeError Nothing Nothing (Just why)
txRejectionToAPIFailureCause (FeeBoundExceeded stage queue quote bound _) =
  Failure (show stage) (Just $ show queue) Blockchain.Data.TransactionResultStatus.FeeBoundExceededError (Just quote) (Just bound) (Just feeBoundAdvice)

tfToBaggerTxRejection :: TransactionFailureCause -> TxRejection
tfToBaggerTxRejection (TFInsufficientFunds cost balance tx) = BalanceTooLow Execution Queued cost balance tx
tfToBaggerTxRejection (TFIntrinsicGasExceedsTxLimit ig txGL tx) = GasLimitTooLow Execution Queued ig txGL tx
tfToBaggerTxRejection TFBlockGasLimitExceeded {} = error "please dont do that (call tfToBaggerTxRejection on a TFBlockGasLimitExceeded)"
tfToBaggerTxRejection (TFNonceMismatch expected _ tx) = NonceTooLow Execution Queued expected tx
tfToBaggerTxRejection (TFTXSizeLimitExceeded limit actual tx) = TXSizeLimitExceeded Execution Queued actual limit tx
tfToBaggerTxRejection (TFIncorrectChainId expected tx) = ChainIdMismatch Execution Queued expected tx
tfToBaggerTxRejection (TFInvalidEnvelope why tx) = InvalidEnvelope Execution Queued why tx
tfToBaggerTxRejection (TFFeeBoundExceeded quote bound tx) = FeeBoundExceeded Execution Queued quote bound tx

feeBoundAdvice :: String
feeBoundAdvice = "The block's STRATO fee exceeds the fee the transaction signed for; requote (eth_gasPrice) and resubmit"

-- | The fee a signed Ethereum envelope permits: its gas limit at its fee per
-- gas (maxFeePerGas for a type-2 envelope), the bound a wallet shows its user.
-- STRATO-native transactions sign no price and set no bound.
signedFeeBound :: TD.Transaction -> Maybe Integer
signedFeeBound TD.EthereumTX {TD.gasPrice = price, TD.gasLimit = limit} = Just (price * limit)
signedFeeBound _ = Nothing

-- | The STRATO fee the installed fee implementation charges in the block being
-- built, read from state the same way the RPC quotes it: DeciderState
-- (0xDEC1DE02) names the implementation and a FeeRouter keeps the block's
-- quote in its own @quotedFee@. 0 where the implementation keeps no quote
-- (DeciderState's legacy payFees) or has not priced yet, so nothing is bound.
quotedStratoFee :: HasSolidStorageDB m => m Integer
quotedStratoFee = do
  impl <- getSolidStorageKeyVal' (Address 0xDEC1DE02) (StoragePath [Field "currentFeeContract"])
  case impl of
    BAddress router -> quoteOf router
    BContract _ router -> quoteOf router
    _ -> return 0
  where
    quoteOf router = do
      quote <- getSolidStorageKeyVal' router (StoragePath [Field "quotedFee"])
      return $ case quote of
        BInteger n -> n
        _ -> 0

-- | Why a transaction cannot pay the block's fee: the fee it signed for does
-- not cover the quote. Only an Ethereum envelope signs a bound, and the quote
-- is 0 wherever nothing is quoted, so STRATO-native transactions and legacy
-- fee implementations are never rejected here. A stale bound means the price
-- moved since the wallet quoted; the fix is a requote, not an open-ended debit.
feeBoundRejection :: Integer -> TD.Transaction -> Maybe (Integer, Integer)
feeBoundRejection quote tx = case signedFeeBound tx of
  Just bound | quote > bound -> Just (quote, bound)
  _ -> Nothing

transactionChainIdValid :: Integer -> TD.Transaction -> Bool
transactionChainIdValid expected tx = TD.chainId tx == Just expected

-- | Whether a transaction must carry the configured chain ID: every one from
-- the replay-protection fork, and a typed Ethereum envelope at any height,
-- since a wallet signs one for a single chain and nothing else binds it here.
chainIdRequired :: Bool -> TD.Transaction -> Bool
chainIdRequired replayProtection tx = replayProtection || case tx of
  TD.EthereumTX {TD.txVersion = ver} -> ver /= 0
  _ -> False

-- | The STRATO-gas envelope boundary, given whether the fork is active at the
-- height the transaction would run. Before it only legacy Ethereum envelopes
-- exist, so nothing signed as a type-2 envelope can be a USDST transfer; from
-- it a native-value transfer must be a type-2 envelope, so nothing signed as a
-- USDST transfer can move STRATO. Legacy calls carrying data keep working on
-- both sides: their value is not a transfer.
envelopeRejection :: Bool -> TD.Transaction -> Maybe String
envelopeRejection stratoGas tx = case tx of
  TD.EthereumTX {TD.txVersion = ver, TD.value = val, TD.txData = dat}
    | not stratoGas, ver /= 0 ->
        Just "typed Ethereum envelopes are accepted from the STRATO-gas fork"
    | stratoGas, ver == 0, val > 0, B.null dat ->
        Just "a native-value transfer must be a type-2 (EIP-1559) envelope from the STRATO-gas fork"
  _ -> Nothing

instance Format TransactionFailureCause where
  format (TFInsufficientFunds cost bal _) = "Insufficient funds: cost " ++ show cost ++ " > balance " ++ show bal
  format (TFIntrinsicGasExceedsTxLimit intG txGL _) = "Intrinsic gas exceeds TX gas limit: intrinsic gas " ++ show intG ++ " > tx gas limit " ++ show txGL
  format (TFBlockGasLimitExceeded txG blkG _) = "Block gas limit exceeded: needed " ++ show txG ++ " > available " ++ show blkG
  format (TFNonceMismatch expected actual _) = "Nonce mismatch: expecting " ++ show expected ++ ", actual " ++ show actual
  format (TFTXSizeLimitExceeded limit actual _) = "TX size limit exceeded: limit of " ++ show limit ++ ", actual " ++ show actual
  format (TFIncorrectChainId expected tx) = "Incorrect chain ID: expected " ++ show expected ++ ", actual " ++ show (TD.chainId $ otBaseTx tx)
  format (TFInvalidEnvelope why _) = "Invalid envelope: " ++ why
  format (TFFeeBoundExceeded quote bound _) = "Fee bound exceeded: quoted fee " ++ show quote ++ " > signed bound " ++ show bound

getDeltasFromResults :: [TxRunResult] -> ValidatorDelta
getDeltasFromResults = foldr go mempty
  where go trr v = case trrResult trr of
          Left _ -> (v)
          Right ExecResults{..} ->
            let vd' = toDelta erNewValidators erRemovedValidators
             in (vd' <> v)

-- | Stake updates published during a block; a later transaction's update for
-- the same validator wins.
getStakeDeltasFromResults :: [TxRunResult] -> StakeDelta
getStakeDeltasFromResults = foldl' go M.empty
  where go acc trr = case trrResult trr of
          Left _ -> acc
          Right ExecResults{..} -> M.union erStakeUpdates acc

-- | Convert a 'TxRunResult' to its canonical 'Receipt' for inclusion in the
-- receipts trie (Phase 0 spec §6.2). Mirrors the gas/status accounting in
-- 'BlockChain.outputTransactionResult':
--
--   * Pre-execution failure (Left) and execution exception both consume the
--     full transaction gas limit and produce 'ReceiptFailure'.
--   * Successful execution produces 'ReceiptSuccess' and gas used =
--     gasLimit - remaining.
--
-- Each emitted SolidVM 'Event' becomes a 'ReceiptLog' whose args are the
-- canonical 'TypedArg' values. Aggregates (arrays, structs, tuples) are
-- resolved by reading the underlying IORef'd 'Variable's — that's why
-- this lives in MonadIO. Args whose Value still can't be canonicalized
-- (mappings, function refs, …) are dropped; see the comment on
-- 'valueToTypedArg' in SolidVM.Model.TypedArg.
txRunResultToReceipt :: MonadIO m => TxRunResult -> m Receipt
txRunResultToReceipt trr = do
  let txGasLim = TD.gasLimit (otBaseTx (trrTransaction trr))
      (status, gasUsed, events) = case trrResult trr of
        Left _ -> (ReceiptFailure, txGasLim, [])
        Right er -> case erException er of
          Just _ -> (ReceiptFailure, txGasLim, erEvents er)
          Nothing -> (ReceiptSuccess, txGasLim - erRemainingTxGas er, erEvents er)
  logs <- traverse eventToReceiptLog events
  pure Receipt
    { receiptStatus = status,
      receiptGasUsed = gasUsed,
      receiptLogs = logs
    }

eventToReceiptLog :: MonadIO m => Event -> m ReceiptLog
eventToReceiptLog ev = do
  args <- traverse (valueToTypedArg . snd) (evArgs ev)
  pure ReceiptLog
    { rlogContractAddress = evContractAddress ev,
      rlogEventName = evName ev,
      rlogArgs = catMaybes args
    }
