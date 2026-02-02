{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Data.ExecResults
  ( calculateReturned,
    evmErrorResults,
    solidvmErrorResults,
    ExecResults (..),
  )
where

import Blockchain.Data.Log
import Blockchain.Data.Transaction
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.Validator
import Blockchain.Stream.Action (Action)
import Blockchain.VM.SolidException
import Blockchain.VM.VMException
import Control.DeepSeq
import qualified Data.Set as S
import GHC.Generics

data ExecResults = ExecResults
  { erRemainingTxGas :: Integer,
    erRefund :: Integer,
    erReturnVal :: Maybe String,
    erTrace :: [String],
    erLogs :: [Log],
    erEvents :: [Event],
    erNewContractAddress :: Maybe Address,
    erSuicideList :: S.Set Address,
    erAction :: Maybe Action,
    erException :: Maybe (Either SolidException VMException),
    erPragmas :: [(String, String)],
    erNewValidators :: [Validator],
    erRemovedValidators :: [Validator]
  }
  deriving (Eq, Show, Generic)

instance NFData ExecResults

calculateReturned :: Transaction -> ExecResults -> Integer
calculateReturned t er =
  let realRefund = min (erRefund er) ((transactionGasLimit t - erRemainingTxGas er) `div` 2)
   in realRefund + erRemainingTxGas er

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
      erRemovedValidators = []
    }
