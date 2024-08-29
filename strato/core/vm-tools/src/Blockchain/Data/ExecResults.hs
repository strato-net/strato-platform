{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Data.ExecResults
  ( calculateReturned,
    evmErrorResults,
    solidvmErrorResults,
    ExecResults (..),
  )
where

import BlockApps.X509.Certificate
import Blockchain.Data.Log
import Blockchain.Data.Transaction
import Blockchain.SolidVM.Model
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Class
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
    erNewContractAccount :: Maybe Account,
    erSuicideList :: S.Set Account,
    erAction :: Maybe Action,
    erException :: Maybe (Either SolidException VMException),
    erKind :: CodeKind,
    erPragmas :: [(String, String)],
    erCreator :: String,
    erAppName :: String,
    erNewValidators :: [Validator],
    erRemovedValidators :: [Validator],
    erNewCerts :: [X509Certificate],
    erRevokedCerts :: [DummyCertRevocation]
  }
  deriving (Eq, Show, Generic)

instance NFData ExecResults

calculateReturned :: Transaction -> ExecResults -> Integer
calculateReturned t er =
  let realRefund = min (erRefund er) ((transactionGasLimit t - erRemainingTxGas er) `div` 2)
   in realRefund + erRemainingTxGas er

evmErrorResults :: Integer -> VMException -> ExecResults
evmErrorResults remainingGas e = errorResults EVM remainingGas (Right e)

solidvmErrorResults :: SolidException -> ExecResults
solidvmErrorResults e = errorResults SolidVM 0 (Left e)

errorResults :: CodeKind -> Integer -> Either SolidException VMException -> ExecResults
errorResults ck remainingGas e =
  ExecResults
    { erRemainingTxGas = remainingGas,
      erRefund = 0,
      erReturnVal = Nothing,
      erTrace = [],
      erLogs = [],
      erEvents = [],
      erNewContractAccount = Nothing,
      erSuicideList = S.empty,
      erAction = Nothing,
      erException = Just e,
      erKind = ck,
      -- , erNewX509Certs = M.empty
      erPragmas = [],
      erCreator = "",
      erAppName = "",
      erNewValidators = [],
      erRemovedValidators = [],
      erNewCerts = [],
      erRevokedCerts = []
    }
