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
import           Blockchain.Data.Event
import           Blockchain.Data.Transaction
import           Blockchain.SolidVM.Model
import           Blockchain.VMOptions

data ExecResults =
  ExecResults {
    erRemainingTxGas     :: Integer,
    erRefund             :: Integer,
    erReturnVal          :: Maybe BSS.ShortByteString,
    erTrace              :: [String],
    erLogs               :: [Log],
    erEvents             :: [Event],
    erNewContractAddress :: Maybe Address,
    erSuicideList        :: S.Set Address,
    erAction             :: Maybe Action,
    erException          :: Maybe (Either SolidException VMException),
    erKind               :: CodeKind
    } deriving (Eq, Show, Generic)

instance NFData ExecResults


calculateReturned :: Transaction -> ExecResults -> Integer
calculateReturned t er =
  let realRefund = min (erRefund er) ((transactionGasLimit t - erRemainingTxGas er) `div` 2)
      addend = if flags_brokenRefundReenable
                 then erRefund er
                 else erRemainingTxGas er
  in realRefund + addend


evmErrorResults :: Integer -> VMException -> ExecResults
evmErrorResults remainingGas e = errorResults EVM remainingGas (Right e)

solidvmErrorResults :: SolidException -> ExecResults
solidvmErrorResults e = errorResults SolidVM 0 (Left e)

errorResults :: CodeKind -> Integer -> Either SolidException VMException -> ExecResults
errorResults ck remainingGas e =
  ExecResults {
    erRemainingTxGas=remainingGas
    , erRefund=0
    , erReturnVal=Nothing
    , erTrace=[]
    , erLogs=[]
    , erEvents=[]
    , erNewContractAddress=Nothing
    , erSuicideList = S.empty
    , erAction = Nothing
    , erException = Just e
    , erKind = ck
    }

