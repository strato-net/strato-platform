
module Blockchain.Data.ExecResults (
  ExecResults(..)
  ) where

import qualified Data.ByteString         as B

import           Blockchain.Data.DataDefs
import           Blockchain.Data.Address
import           Blockchain.Data.Log

data ExecResults =
  ExecResults {
    erSuccess            :: Bool,
    erBlockData          :: BlockData,
    erRemainingBlockGas  :: Integer,
    erRemainingTxGas     :: Integer,
    erReturnVal          :: Maybe B.ByteString,
    erTrace              :: [String],
    erLogs               :: [Log],
    erSender             :: Address,
    erNewContractAddress :: Maybe Address
    }
