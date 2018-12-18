module Blockchain.Bagger.Transactions where

import           Control.DeepSeq
import qualified Data.Map                           as M
import           Data.Time.Clock

import           GHC.Generics

import           Blockchain.DB.MemAddressStateDB

import           Blockchain.Data.Address
import           Blockchain.Data.ExecResults
import qualified Blockchain.Data.TransactionDef     as TD
import           Blockchain.Data.TransactionResultStatus
import           Blockchain.Database.MerklePatricia (StateRoot (..))
import           Blockchain.Format
import           Blockchain.Sequencer.Event         (OutputTx (..))
import           Blockchain.SHA                     hiding (hash)

data TxRunResult = TxRunResult { trrTransaction :: OutputTx
                               , trrResult      :: Either TransactionFailureCause ExecResults
                               , trrTime        :: NominalDiffTime
                               , trrBeforeMap   :: M.Map Address AddressStateModification
                               , trrAfterMap    :: M.Map Address AddressStateModification
                               } deriving (Show, Generic)

instance NFData TxRunResult

data TransactionFailureCause = TFInsufficientFunds Integer Integer OutputTx -- txCost, accountBalance
                             | TFIntrinsicGasExceedsTxLimit Integer Integer OutputTx -- intrinsicGas, txGasLimit
                             | TFBlockGasLimitExceeded Integer Integer OutputTx-- neededGas, actualGas
                             | TFNonceMismatch Integer Integer OutputTx -- expectedNonce, actualNonce
                             deriving (Eq, Read, Show, Generic)

instance NFData TransactionFailureCause

data RunAttemptState = RunAttemptState { rasRanTxs    :: [TxRunResult]
                                       , rasUnranTxs  :: [OutputTx]
                                       , rasStateRoot :: StateRoot
                                       , rasRemGas    :: Integer
                                       } deriving (Show)

data RunAttemptError = CantFindStateRoot
                     | GasLimitReached [TxRunResult] [OutputTx] StateRoot Integer    -- ran, unran, new stateroot, remgas
                     | RecoverableFailure TxRejection [TxRunResult] [OutputTx] StateRoot Integer -- this means the culprit can be dropped from the pool and the block can continue
                     deriving (Show)                                                -- same order of args

data BaggerTxQueue = Incoming | Pending | Queued deriving (Eq, Read, Show)

data TxRejection = NonceTooLow    BaggerStage BaggerTxQueue Integer OutputTx -- integers: needed nonce
                 | BalanceTooLow  BaggerStage BaggerTxQueue Integer Integer OutputTx -- integers: needed balance, actual balance
                 | GasLimitTooLow BaggerStage BaggerTxQueue Integer OutputTx -- queue should probably only be Validation, integer is intrinsic gas
                 | LessLucrative  BaggerStage BaggerTxQueue OutputTx OutputTx -- newTx, oldTx
                 deriving (Eq, Read, Show)

rejectedTx :: TxRejection -> OutputTx
rejectedTx (NonceTooLow _ _ _ t)     = t
rejectedTx (BalanceTooLow _ _ _ _ t) = t
rejectedTx (GasLimitTooLow _ _ _ t)  = t
rejectedTx (LessLucrative _ _ _ t)   = t

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
        "\n\tavailable balance " ++ show actual ++
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

txRejectionToAPIFailureCause :: TxRejection -> TransactionResultStatus
txRejectionToAPIFailureCause (NonceTooLow    stage queue needed tx) =
    Failure (show stage) (Just $ show queue) IncorrectNonce (Just needed) (Just . TD.transactionNonce $ otBaseTx tx) Nothing
txRejectionToAPIFailureCause (BalanceTooLow  stage queue needed actual _) =
    Failure (show stage) (Just $ show queue) Blockchain.Data.TransactionResultStatus.InsufficientFunds (Just needed) (Just actual) Nothing
txRejectionToAPIFailureCause (GasLimitTooLow stage queue needed tx) =
    Failure (show stage) (Just $ show queue) IntrinsicGasExceedsLimit (Just needed) (Just . TD.transactionGasLimit $ otBaseTx tx) Nothing
txRejectionToAPIFailureCause (LessLucrative  stage queue newTx _) =
    Failure (show stage) (Just $ show queue) TrumpedByMoreLucrative Nothing Nothing (Just $ "trumped by " ++ formatSHAWithoutColor (otHash newTx))

tfToBaggerTxRejection :: TransactionFailureCause -> TxRejection
tfToBaggerTxRejection (TFInsufficientFunds cost balance tx) = BalanceTooLow Execution Queued cost balance tx
tfToBaggerTxRejection (TFIntrinsicGasExceedsTxLimit ig _ tx) = GasLimitTooLow Execution Queued ig tx
tfToBaggerTxRejection TFBlockGasLimitExceeded{} = error "please dont do that (call tfToBaggerTxRejection on a TFBlockGasLimitExceeded)"
tfToBaggerTxRejection (TFNonceMismatch expected _ tx) = NonceTooLow Execution Queued expected tx

instance Format TransactionFailureCause where
    format (TFInsufficientFunds cost bal _) = "Insufficient funds: cost " ++ show cost ++ " > balance " ++ show bal
    format (TFIntrinsicGasExceedsTxLimit intG txGL _) = "Intrinsic gas exceeds TX gas limit: intrinsic gas " ++ show intG ++ " > tx gas limit " ++ show txGL
    format (TFBlockGasLimitExceeded txG blkG _) = "Block gas limit exceeded: needed " ++ show txG ++ " > available " ++ show blkG
    format (TFNonceMismatch expected actual _) = "Nonce mismatch: expecting " ++ show expected ++ ", actual " ++ show actual
