{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE RecordWildCards #-}

module Blockchain.Bagger.Transactions where

import Blockchain.DB.MemAddressStateDB
import Blockchain.Data.ExecResults
import Blockchain.Data.TXOrigin
import qualified Blockchain.Data.TransactionDef as TD
import Blockchain.Data.TransactionResultStatus
import Blockchain.Database.MerklePatricia (StateRoot (..))
import Blockchain.Sequencer.Event (OutputTx (..))
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Delta
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256 hiding (hash)
import qualified Blockchain.Stream.Action as Action
import Control.DeepSeq
import Control.Lens.Setter (set)
import qualified Data.Map as M
import Data.Time.Clock
import GHC.Generics
import Text.Format

data TxRunResult = TxRunResult
  { trrTransaction :: OutputTx,
    trrResult :: Either TransactionFailureCause ExecResults,
    trrTime :: NominalDiffTime,
    trrBeforeMap :: M.Map Account AddressStateModification,
    trrAfterMap :: M.Map Account AddressStateModification,
    trrNewAddresses :: [Account]
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
  = TFIntrinsicGasExceedsTxLimit Integer Integer OutputTx -- intrinsicGas, txGasLimit
  | TFBlockGasLimitExceeded Integer Integer OutputTx -- neededGas, actualGas
  | TFNonceMismatch Integer Integer OutputTx -- expectedNonce, actualNonce
  | TFChainIdMismatch (Maybe Word256) (Maybe Word256) OutputTx -- expectedChainId, actualChainId
  | TFCodeCollectionNotFound Account String OutputTx
  | TFInvalidPragma [(String, String)] OutputTx
  | TFNonceLimitExceeded Integer Integer OutputTx -- accountNonceLimit, actualNonce
  | TFTXSizeLimitExceeded Integer Integer OutputTx -- txSizeLimit, actualSize
  | TFKnownFailedTX OutputTx
  | TFTransactionGasExceeded Integer Integer OutputTx
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
  = WrongChainId BaggerStage BaggerTxQueue OutputTx -- only public transactions are run by the bagger
  | NonceTooLow BaggerStage BaggerTxQueue Integer OutputTx -- integers: needed nonce
  | BalanceTooLow BaggerStage BaggerTxQueue Integer Integer OutputTx -- integers: needed balance, actual balance
  | GasLimitTooLow BaggerStage BaggerTxQueue Integer OutputTx -- queue should probably only be Validation, integer is intrinsic gas
  | LessLucrative BaggerStage BaggerTxQueue OutputTx OutputTx -- newTx, oldTx
  | CodeNotFound BaggerStage BaggerTxQueue Account String OutputTx
  | InvalidPragma BaggerStage BaggerTxQueue [(String, String)] OutputTx
  | NonceLimitExceeded BaggerStage BaggerTxQueue Integer Integer OutputTx
  | TXSizeLimitExceeded BaggerStage BaggerTxQueue Integer Integer OutputTx
  | GasLimitExceeded BaggerStage BaggerTxQueue Integer Integer OutputTx
  | KnownFailedTX BaggerStage BaggerTxQueue OutputTx
  deriving (Eq, Read, Show)

rejectedTx :: TxRejection -> OutputTx
rejectedTx (WrongChainId _ _ t) = t
rejectedTx (NonceTooLow _ _ _ t) = t
rejectedTx (BalanceTooLow _ _ _ _ t) = t
rejectedTx (GasLimitTooLow _ _ _ t) = t
rejectedTx (LessLucrative _ _ _ t) = t
rejectedTx (CodeNotFound _ _ _ _ t) = t
rejectedTx (InvalidPragma _ _ _ t) = t
rejectedTx (NonceLimitExceeded _ _ _ _ t) = t
rejectedTx (TXSizeLimitExceeded _ _ _ _ t) = t
rejectedTx (GasLimitExceeded _ _ _ _ t) = t
rejectedTx (KnownFailedTX _ _ t) = t

data BaggerStage = Insertion | Validation | Promotion | Demotion | Execution deriving (Read, Eq, Show)

instance Format TxRejection where
  format (WrongChainId stage queue o@OutputTx {otHash = hash, otBaseTx = bt}) =
    "WrongChainId at stage " ++ show stage ++ " in queue " ++ show queue
      ++ "\n\tactual chain ID "
      ++ TD.formatChainId (txChainId bt)
      ++ "\n\ttx hash "
      ++ format hash
      ++ "\n"
      ++ format o
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
  format (GasLimitTooLow stage queue actual o@OutputTx {otHash = hash}) =
    "GasLimitTooLow at stage " ++ show stage ++ " in queue " ++ show queue
      ++ "\n\tactual gas limit "
      ++ show actual
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
  format (CodeNotFound stage queue address name o) =
    "CodeNotFound at stage " ++ show stage ++ " in queue " ++ show queue
      ++ "\n\ttarget address "
      ++ format address
      ++ "\n\tcontract name "
      ++ name
      ++ "\n"
      ++ format o
  format (InvalidPragma stage queue erPragmas' o@OutputTx {otHash = hash}) =
    "InvalidPragma at stage " ++ show stage ++ " in queue " ++ show queue ++ " prag " ++ show erPragmas'
      ++ "\n\ttx hash "
      ++ format hash
      ++ "\n"
      ++ format o
  format (NonceLimitExceeded stage queue actual limit o@OutputTx {otHash = hash}) =
    "NonceLimitExceeded at stage " ++ show stage ++ " in queue " ++ show queue
      ++ "\n\tactual nonce "
      ++ show actual
      ++ "\n\tnonce limit"
      ++ show limit
      ++ "\n\ttx hash "
      ++ format hash
      ++ "\n"
      ++ format o
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
  format (GasLimitExceeded stage queue actual limit o@OutputTx {otHash = hash}) =
    "GasLimitExceeded at stage " ++ show stage ++ " in queue " ++ show queue
      ++ "\n\tactual gas "
      ++ show actual
      ++ "\n\tgas limit "
      ++ show limit
      ++ "\n\ttx hash "
      ++ format hash
      ++ "\n"
      ++ format o
  format (KnownFailedTX stage queue o@OutputTx {otHash = hash}) =
    "KnownFailedTX at stage " ++ show stage ++ " in queue " ++ show queue
      ++ "\n\ttx hash "
      ++ format hash
      ++ "\n"
      ++ format o

txRejectionToAPIFailureCause :: TxRejection -> TransactionResultStatus
txRejectionToAPIFailureCause (WrongChainId stage queue tx) =
  Failure (show stage) (Just $ show queue) IncorrectChainId Nothing (fmap toInteger . txChainId $ otBaseTx tx) Nothing
txRejectionToAPIFailureCause (NonceTooLow stage queue needed tx) =
  Failure (show stage) (Just $ show queue) IncorrectNonce (Just needed) (Just . TD.transactionNonce $ otBaseTx tx) Nothing
txRejectionToAPIFailureCause (BalanceTooLow stage queue needed actual _) =
  Failure (show stage) (Just $ show queue) Blockchain.Data.TransactionResultStatus.InsufficientFunds (Just needed) (Just actual) Nothing
txRejectionToAPIFailureCause (GasLimitTooLow stage queue needed tx) =
  Failure (show stage) (Just $ show queue) IntrinsicGasExceedsLimit (Just needed) (Just . TD.transactionGasLimit $ otBaseTx tx) Nothing
txRejectionToAPIFailureCause (LessLucrative stage queue newTx _) =
  Failure (show stage) (Just $ show queue) TrumpedByMoreLucrative Nothing Nothing (Just $ "trumped by " ++ formatKeccak256WithoutColor (otHash newTx))
txRejectionToAPIFailureCause (CodeNotFound stage queue address name _) =
  Failure (show stage) (Just $ show queue) MissingCode Nothing Nothing (Just $ "code not found at address " ++ format address ++ " with name " ++ name)
txRejectionToAPIFailureCause (InvalidPragma stage queue erPragmas' tx) =
  Failure (show stage) (Just $ show queue) InvalidPragmaType Nothing Nothing (Just $ "invalid pragma " ++ show erPragmas' ++ " in tx " ++ format (otBaseTx tx))
txRejectionToAPIFailureCause (NonceLimitExceeded stage queue actual limit _) =
  Failure (show stage) (Just $ show queue) Blockchain.Data.TransactionResultStatus.NonceLimitError (Just limit) (Just actual) (Just $ "Current nonce is " ++ show actual ++ " but the limit is " ++ show limit)
txRejectionToAPIFailureCause (TXSizeLimitExceeded stage queue actual limit _) =
  Failure (show stage) (Just $ show queue) Blockchain.Data.TransactionResultStatus.TXSizeLimitError (Just limit) (Just actual) (Just $ "The TX size is " ++ show actual ++ " but the limit is " ++ show limit)
txRejectionToAPIFailureCause (GasLimitExceeded stage queue actual limit _) =
  Failure (show stage) (Just $ show queue) Blockchain.Data.TransactionResultStatus.GasLimitError (Just limit) (Just actual) (Just $ "The transaction takes " ++ show actual ++ " gas but the limit is " ++ show limit)
txRejectionToAPIFailureCause (KnownFailedTX stage queue t) =
  Failure (show stage) (Just $ show queue) Blockchain.Data.TransactionResultStatus.KnownFailedTXError Nothing Nothing (Just $ "The transaction " ++ show (otHash t) ++ " is known to fail")

tfToBaggerTxRejection :: TransactionFailureCause -> TxRejection
tfToBaggerTxRejection (TFIntrinsicGasExceedsTxLimit ig _ tx) = GasLimitTooLow Execution Queued ig tx
tfToBaggerTxRejection TFBlockGasLimitExceeded {} = error "please dont do that (call tfToBaggerTxRejection on a TFBlockGasLimitExceeded)"
tfToBaggerTxRejection (TFNonceMismatch expected _ tx) = NonceTooLow Execution Queued expected tx
tfToBaggerTxRejection (TFChainIdMismatch _ _ tx) = WrongChainId Validation Queued tx
tfToBaggerTxRejection (TFCodeCollectionNotFound addr name tx) = CodeNotFound Validation Queued addr name tx
tfToBaggerTxRejection (TFInvalidPragma erPragmas' tx) = InvalidPragma Validation Queued erPragmas' tx
tfToBaggerTxRejection (TFNonceLimitExceeded limit actual tx) = NonceLimitExceeded Execution Queued actual limit tx
tfToBaggerTxRejection (TFTXSizeLimitExceeded limit actual tx) = TXSizeLimitExceeded Execution Queued actual limit tx
tfToBaggerTxRejection (TFKnownFailedTX tx) = KnownFailedTX Execution Queued tx
tfToBaggerTxRejection (TFTransactionGasExceeded limit actual tx) = GasLimitExceeded Execution Queued actual limit tx

instance Format TransactionFailureCause where
  format (TFIntrinsicGasExceedsTxLimit intG txGL _) = "Intrinsic gas exceeds TX gas limit: intrinsic gas " ++ show intG ++ " > tx gas limit " ++ show txGL
  format (TFBlockGasLimitExceeded txG blkG _) = "Block gas limit exceeded: needed " ++ show txG ++ " > available " ++ show blkG
  format (TFNonceMismatch expected actual _) = "Nonce mismatch: expecting " ++ show expected ++ ", actual " ++ show actual
  format (TFChainIdMismatch expected actual _) = "Chain ID mismatch: expecting " ++ TD.formatChainId expected ++ ", actual " ++ TD.formatChainId actual
  format (TFCodeCollectionNotFound addr name _) = "Code collection not found at address " ++ format addr ++ " with name " ++ name
  format (TFInvalidPragma erPragmas' _) = "Invalid pragma: " ++ show erPragmas'
  format (TFNonceLimitExceeded limit actual _) = "Nonce limit exceeded: limit of " ++ show limit ++ ", actual " ++ show actual
  format (TFTXSizeLimitExceeded limit actual _) = "TX size limit exceeded: limit of " ++ show limit ++ ", actual " ++ show actual
  format (TFKnownFailedTX t) = "Known failed tx: " ++ show (otHash t)
  format (TFTransactionGasExceeded limit actual _) = "Transaction gas limit exceeded: limit of " ++ show limit ++ ", actual " ++ show actual

getDeltasFromResults :: [TxRunResult] -> (ValidatorDelta, CertDelta)
getDeltasFromResults = foldr go (mempty,mempty)
  where go trr (v,c) = case trrResult trr of
          Left _ -> (v,c)
          Right ExecResults{..} ->
            let vd' = toDelta erNewValidators erRemovedValidators
                cd' = toDelta erNewCerts      erRevokedCerts
             in (vd' <> v, cd' <> c)