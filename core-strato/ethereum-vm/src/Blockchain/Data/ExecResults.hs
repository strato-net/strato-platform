{-# LANGUAGE DeriveGeneric   #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Data.ExecResults where

import           Control.DeepSeq
import qualified Data.ByteString         as B
import           GHC.Generics

import           Blockchain.VM.VMException
import           Blockchain.Data.Action
import           Blockchain.Data.Address
import           Blockchain.Data.Log

data ExecResults =
  ExecResults {
    erRemainingBlockGas  :: Integer,
    erRemainingTxGas     :: Integer,
    erReturnVal          :: Maybe B.ByteString,
    erTrace              :: [String],
    erLogs               :: [Log],
    erNewContractAddress :: Maybe Address,
    erAction             :: Maybe Action,
    erException          :: Maybe VMException
    } deriving (Show, Generic)

instance NFData ExecResults
