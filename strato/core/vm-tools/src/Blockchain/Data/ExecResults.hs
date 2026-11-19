{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Data.ExecResults
  ( calculateReturned,
    evmErrorResults,
    solidvmErrorResults,
    prependConsensusDeltas,
    ExecResults (..),
  )
where

import Blockchain.Data.Log
import Blockchain.Data.Transaction
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Validator
import Blockchain.Stream.Action (Action)
import Blockchain.VM.SolidException
import Blockchain.VM.VMException
import Control.DeepSeq
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import GHC.Generics
import SolidVM.Model.Delta (StakeDelta)
import SolidVM.Model.Event
import SolidVM.Model.Value (Value)

data ExecResults = ExecResults
  { erRemainingTxGas :: Integer,
    erRefund :: Integer,
    erReturnVal :: Maybe Value,
    erTrace :: [String],
    erLogs :: [Log],
    erEvents :: [Event],
    erNewContractAddress :: Maybe Address,
    erSuicideList :: S.Set Address,
    erAction :: Maybe Action,
    erException :: Maybe (Either SolidException VMException),
    erPragmas :: [(String, String)],
    erNewValidators :: [Validator],
    erRemovedValidators :: [Validator],
    erStakeUpdates :: StakeDelta
  }
  deriving (Eq, Show, Generic)

instance NFData ExecResults

calculateReturned :: Transaction -> ExecResults -> Integer
calculateReturned t er =
  let realRefund = min (erRefund er) ((gasLimit t - erRemainingTxGas er) `div` 2)
   in realRefund + erRemainingTxGas er

-- | Carry the validator-set and stake changes of a call that ran ahead of @er@
-- (the fee payment precedes its transaction) into @er@, in execution order: the
-- earlier call's validators come first, and a stake weight published by @er@
-- replaces the earlier call's for the same validator.
prependConsensusDeltas :: ExecResults -> ExecResults -> ExecResults
prependConsensusDeltas earlier er =
  er
    { erNewValidators = erNewValidators earlier ++ erNewValidators er,
      erRemovedValidators = erRemovedValidators earlier ++ erRemovedValidators er,
      erStakeUpdates = M.union (erStakeUpdates er) (erStakeUpdates earlier)
    }

evmErrorResults :: Integer -> VMException -> ExecResults
evmErrorResults remainingGas e = errorResults remainingGas (Right e)

solidvmErrorResults :: SolidException -> ExecResults
solidvmErrorResults e = errorResults 0 (Left e)



errorResults :: Integer -> Either SolidException VMException -> ExecResults
errorResults remainingGas e =
  ExecResults
    { erRemainingTxGas = remainingGas,
      erRefund = 0,
      erReturnVal = Nothing,
      erTrace = [],
      erLogs = [],
      erEvents = [],
      erNewContractAddress = Nothing,
      erSuicideList = S.empty,
      erAction = Nothing,
      erException = Just e,
      -- , erNewX509Certs = M.empty
      erPragmas = [],
      erNewValidators = [],
      erRemovedValidators = [],
      erStakeUpdates = M.empty
    }
