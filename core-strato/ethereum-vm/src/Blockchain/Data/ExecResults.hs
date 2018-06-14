module Blockchain.Data.ExecResults (
  ExecResults(..)
  ) where

import qualified Data.ByteString         as B

import           Blockchain.VM.VMException
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
    erException          :: Maybe VMException
    } deriving (Show)
