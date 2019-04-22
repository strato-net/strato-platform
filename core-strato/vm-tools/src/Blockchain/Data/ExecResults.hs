{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Data.ExecResults
  ( calculateReturned
  , evmErrorResults
  , solidvmErrorResults
  , ExecResults(..)
  ) where

import           Control.DeepSeq
import qualified Data.ByteString.Short   as BSS
import qualified Data.Set                as S
import           GHC.Generics

import           Blockchain.VM.SolidException
import           Blockchain.VM.VMException
import           Blockchain.Strato.Model.Action
import           Blockchain.Data.Address
import           Blockchain.Data.Log
import           Blockchain.Data.Transaction

data ExecResults =
  ExecResults {
    erRemainingTxGas     :: Integer,
    erRefund             :: Integer,
    erReturnVal          :: Maybe BSS.ShortByteString,
    erTrace              :: [String],
    erLogs               :: [Log],
    erNewContractAddress :: Maybe Address,
    erSuicideList        :: S.Set Address,
    erAction             :: Maybe Action,
    erException          :: Maybe (Either SolidException VMException)
    } deriving (Eq, Show, Generic)

instance NFData ExecResults


calculateReturned :: Transaction -> ExecResults -> Integer
calculateReturned t er =
  let realRefund = min (erRefund er) ((transactionGasLimit t - erRemainingTxGas er) `div` 2)
  in realRefund + reRefund er


evmErrorResults :: Integer -> VMException -> ExecResults
evmErrorResults remainingGas e = errorResults remainingGas (Right e)

solidvmErrorResults :: SolidException -> ExecResults
solidvmErrorResults e = errorResults 0 (Left e)

errorResults :: Integer -> Either SolidException VMException -> ExecResults
errorResults remainingGas e =
  ExecResults {
    erRemainingTxGas=remainingGas
    , erRefund=0
    , erReturnVal=Nothing
    , erTrace=[]
    , erLogs=[]
    , erNewContractAddress=Nothing
    , erSuicideList = S.empty
    , erAction = Nothing
    , erException = Just e
    }

