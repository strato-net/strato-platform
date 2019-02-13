{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Data.ExecResults where

import           Control.DeepSeq
import qualified Data.ByteString         as B
import qualified Data.Set                as S
import           GHC.Generics

import           Blockchain.VM.VMException
import           Blockchain.Data.Action
import           Blockchain.Data.Address
import           Blockchain.Data.Log
import           Blockchain.Data.Transaction

data ExecResults =
  ExecResults {
    erRemainingTxGas     :: Integer,
    erRefund             :: Integer,
    erReturnVal          :: Maybe B.ByteString,
    erTrace              :: [String],
    erLogs               :: [Log],
    erNewContractAddress :: Maybe Address,
    erSuicideList        :: S.Set Address,
    erAction             :: Maybe Action,
    erException          :: Maybe VMException
    } deriving (Show, Generic)

instance NFData ExecResults


calculateReturned :: Transaction -> ExecResults -> Integer
calculateReturned t er =
  let realRefund = min (erRefund er) ((transactionGasLimit t - erRemainingTxGas er) `div` 2)
  in realRefund + erRemainingTxGas er
  

