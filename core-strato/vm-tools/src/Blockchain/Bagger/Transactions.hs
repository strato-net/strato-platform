{-# LANGUAGE DeriveGeneric #-}
module Blockchain.Bagger.Transactions where

import           Control.DeepSeq
import           Control.Lens.Setter                (set)
import qualified Data.Map                           as M
import           Data.Time.Clock

import           GHC.Generics

import           Blockchain.DB.MemAddressStateDB

import           Blockchain.Data.ExecResults
import qualified Blockchain.Data.TransactionDef     as TD
import           Blockchain.Data.TransactionResultStatus
import           Blockchain.Data.TXOrigin
import           Blockchain.Database.MerklePatricia (StateRoot (..))
import           Blockchain.ExtWord
import           Blockchain.Sequencer.Event         (OutputTx (..))
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.Keccak256  hiding (hash)
import qualified Blockchain.Stream.Action           as Action

import           Text.Format

data TxRunResult = TxRunResult { trrTransaction :: OutputTx
                               , trrResult      :: Either TransactionFailureCause ExecResults
                               , trrTime        :: NominalDiffTime
                               , trrBeforeMap   :: M.Map Account AddressStateModification
                               , trrAfterMap    :: M.Map Account AddressStateModification
                               , trrNewAddresses :: [Account]
                               } deriving (Show, Eq, Generic)

-- When we use a cached TxRunResult, the blockHash does not account for consensus values added.
rewriteBlockHash :: Keccak256 -> TxRunResult -> TxRunResult
rewriteBlockHash hsh (TxRunResult otx res t before after new) =
  TxRunResult otx{otOrigin = BlockHash hsh} res' t before after new
  where res' = case res of
                  Left{} -> res
                  Right er@ExecResults {erAction=mAction}-> Right er{erAction = set Action.blockHash hsh <$> mAction}

instance NFData TxRunResult

data TransactionFailureCause = TFInsufficientFunds Integer Integer OutputTx -- txCost, accountBalance
                             | TFIntrinsicGasExceedsTxLimit Integer Integer OutputTx -- intrinsicGas, txGasLimit
                             | TFBlockGasLimitExceeded Integer Integer OutputTx-- neededGas, actualGas
                             | TFNonceMismatch Integer Integer OutputTx -- expectedNonce, actualNonce
                             | TFChainIdMismatch (Maybe Word256) (Maybe Word256) OutputTx -- expectedChainId, actualChainId
                             | TFCodeCollectionNotFound Account String OutputTx
                             | TFInvalidPragma String OutputTx -- pragma
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

data TxRejection = WrongChainId   BaggerStage BaggerTxQueue OutputTx -- only public transactions are run by the bagger
                 | NonceTooLow    BaggerStage BaggerTxQueue Integer OutputTx -- integers: needed nonce
                 | BalanceTooLow  BaggerStage BaggerTxQueue Integer Integer OutputTx -- integers: needed balance, actual balance
                 | GasLimitTooLow BaggerStage BaggerTxQueue Integer OutputTx -- queue should probably only be Validation, integer is intrinsic gas
                 | LessLucrative  BaggerStage BaggerTxQueue OutputTx OutputTx -- newTx, oldTx
                 | CodeNotFound   BaggerStage BaggerTxQueue Account String OutputTx
                 | InvalidPragma  BaggerStage BaggerTxQueue String OutputTx -- pragma
                 deriving (Eq, Read, Show)

rejectedTx :: TxRejection -> OutputTx
rejectedTx (WrongChainId _ _ t)      = t
rejectedTx (NonceTooLow _ _ _ t)     = t
rejectedTx (BalanceTooLow _ _ _ _ t) = t
rejectedTx (GasLimitTooLow _ _ _ t)  = t
rejectedTx (LessLucrative _ _ _ t)   = t
rejectedTx (CodeNotFound _ _ _ _ t)  = t
rejectedTx (InvalidPragma _ _ _ t)   = t

data BaggerStage = Insertion | Validation | Promotion | Demotion | Execution deriving (Read, Eq, Show)

instance Format TxRejection where
    format (WrongChainId   stage queue o@OutputTx{otHash=hash, otBaseTx=bt}) =
        "WrongChainId at stage "    ++ show stage ++ " in queue " ++ show queue ++
        "\n\tactual chain ID "     ++ TD.formatChainId (txChainId bt) ++
        "\n\ttx hash " ++ format hash ++
        "\n" ++ format o
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
    format (CodeNotFound stage queue address name o) =
        "GasLimitTooLow at stage " ++ show stage ++ " in queue " ++ show queue ++
        "\n\ttarget address " ++ format address ++
        "\n\tcontract name " ++ name ++
        "\n" ++ format o
    format (InvalidPragma stage queue pragma o) =
        "InvalidPragma at stage " ++ show stage ++ " in queue " ++ show queue ++
        "\n\tpragma " ++ pragma ++
        "\n" ++ format o


txRejectionToAPIFailureCause :: TxRejection -> TransactionResultStatus
txRejectionToAPIFailureCause (WrongChainId   stage queue tx) =
    Failure (show stage) (Just $ show queue) IncorrectChainId Nothing (fmap toInteger . txChainId $ otBaseTx tx) Nothing
txRejectionToAPIFailureCause (NonceTooLow    stage queue needed tx) =
    Failure (show stage) (Just $ show queue) IncorrectNonce (Just needed) (Just . TD.transactionNonce $ otBaseTx tx) Nothing
txRejectionToAPIFailureCause (BalanceTooLow  stage queue needed actual _) =
    Failure (show stage) (Just $ show queue) Blockchain.Data.TransactionResultStatus.InsufficientFunds (Just needed) (Just actual) Nothing
txRejectionToAPIFailureCause (GasLimitTooLow stage queue needed tx) =
    Failure (show stage) (Just $ show queue) IntrinsicGasExceedsLimit (Just needed) (Just . TD.transactionGasLimit $ otBaseTx tx) Nothing
txRejectionToAPIFailureCause (LessLucrative  stage queue newTx _) =
    Failure (show stage) (Just $ show queue) TrumpedByMoreLucrative Nothing Nothing (Just $ "trumped by " ++ formatKeccak256WithoutColor (otHash newTx))
txRejectionToAPIFailureCause (CodeNotFound  stage queue address name _) =
    Failure (show stage) (Just $ show queue) MissingCode Nothing Nothing (Just $ "code not found at address " ++ format address ++ " with name " ++ name)
txRejectionToAPIFailureCause (InvalidPragma stage queue pragma _) = Blockchain.Data.TransactionResultStatus.InvalidPragma (show stage) (Just $ show queue) pragma Nothing

tfToBaggerTxRejection :: TransactionFailureCause -> TxRejection
tfToBaggerTxRejection (TFInsufficientFunds cost balance tx) = BalanceTooLow Execution Queued cost balance tx
tfToBaggerTxRejection (TFIntrinsicGasExceedsTxLimit ig _ tx) = GasLimitTooLow Execution Queued ig tx
tfToBaggerTxRejection TFBlockGasLimitExceeded{} = error "please dont do that (call tfToBaggerTxRejection on a TFBlockGasLimitExceeded)"
tfToBaggerTxRejection (TFNonceMismatch expected _ tx) = NonceTooLow Execution Queued expected tx
tfToBaggerTxRejection (TFChainIdMismatch _ _ tx) = WrongChainId Validation Queued tx
tfToBaggerTxRejection (TFCodeCollectionNotFound addr name tx) = CodeNotFound Validation Queued addr name tx
tfToBaggerTxRejection (TFInvalidPragma pragma tx) = InvalidPragma Validation Queued pragma tx

instance Format TransactionFailureCause where
    format (TFInsufficientFunds cost bal _) = "Insufficient funds: cost " ++ show cost ++ " > balance " ++ show bal
    format (TFIntrinsicGasExceedsTxLimit intG txGL _) = "Intrinsic gas exceeds TX gas limit: intrinsic gas " ++ show intG ++ " > tx gas limit " ++ show txGL
    format (TFBlockGasLimitExceeded txG blkG _) = "Block gas limit exceeded: needed " ++ show txG ++ " > available " ++ show blkG
    format (TFNonceMismatch expected actual _) = "Nonce mismatch: expecting " ++ show expected ++ ", actual " ++ show actual
    format (TFChainIdMismatch expected actual _) = "Chain ID mismatch: expecting " ++ TD.formatChainId expected ++ ", actual " ++ TD.formatChainId actual
    format (TFCodeCollectionNotFound addr name _) = "Code collection not found at address " ++ format addr ++ " with name " ++ name
    format (TFInvalidPragma pragma _) = "Invalid pragma: " ++ pragma
