
module Blockchain.Data.ExecResults (
  ExecResults(..)
  ) where

import qualified Data.ByteString as B

import Blockchain.Data.Address
import Blockchain.Data.Log

data ExecResults =
  ExecResults {
    erRemainingBlockGas::Integer,
    erReturnVal::Maybe B.ByteString,
    erTrace::[String],
    erLogs::[Log],
    erNewContractAddress::Maybe Address
    }
