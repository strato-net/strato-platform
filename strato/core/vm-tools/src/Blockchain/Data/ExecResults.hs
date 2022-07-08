{-# LANGUAGE DeriveGeneric #-}
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
import           Data.Map                as M

import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Event

import           Blockchain.VM.SolidException
import           Blockchain.VM.VMException
import           Blockchain.Data.Log
import           Blockchain.Data.Transaction
import           Blockchain.SolidVM.Model
import           Blockchain.Stream.Action      (Action)
import           Blockchain.VMOptions

import           BlockApps.X509.Certificate

import           Text.Format
import           Text.Tools

data ExecResults =
  ExecResults {
    erRemainingTxGas     :: Integer,
    erRefund             :: Integer,
    erReturnVal          :: Maybe BSS.ShortByteString,
    erTrace              :: [String],
    erLogs               :: [Log],
    erEvents             :: [Event],
    erNewContractAccount :: Maybe Account,
    erSuicideList        :: S.Set Account,
    erAction             :: Maybe Action,
    erException          :: Maybe (Either SolidException VMException),
    erKind               :: CodeKind,
    erNewX509Certs       :: M.Map Address X509Certificate
    } deriving (Eq, Show, Generic)

instance Format ExecResults where
  format v =
      "ExecResults:"
      ++ "\n  erRemainingTxGas: " ++ show (erRemainingTxGas v)
      ++ "\n  erRefund: " ++ show (erRefund v)
      ++ "\n  erReturnVal: " ++ show (erReturnVal v)
      ++ "\n  erTrace: " ++ show (erTrace v)
      ++ "\n  erLogs: " ++ show (erLogs v)
      ++ "\n  erEvents: " ++ format (erEvents v)
      ++ "\n  erNewContractAccount: " ++ format (erNewContractAccount v)
      ++ "\n  erSuicideList: " ++ show (erSuicideList v)
      ++ "\n  erAction:\n" ++ tab (tab (format (erAction v)))
      ++ "\n  erException: " ++ show (erException v)
      ++ "\n  erKind: " ++ show (erKind v)
      ++ "\n  erNewX509Certs: " ++ show (erNewX509Certs v)

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
    , erNewContractAccount=Nothing
    , erSuicideList = S.empty
    , erAction = Nothing
    , erException = Just e
    , erKind = ck
    , erNewX509Certs = M.empty
    }

