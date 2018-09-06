module Blockchain.Data.ExecResults (
  ExecResults(..)
  ) where

import qualified Data.ByteString         as B
import qualified Data.Map.Strict         as M

import           Blockchain.VM.VMException
import           Blockchain.Data.Address
import           Blockchain.Data.Log
import           Blockchain.ExtWord        (Word256)

data ExecResults =
  ExecResults {
    erRemainingBlockGas  :: Integer,
    erRemainingTxGas     :: Integer,
    erReturnVal          :: Maybe B.ByteString,
    erTrace              :: [String],
    erLogs               :: [Log],
    erNewContractAddress :: Maybe Address,
    erStorageDiffs       :: M.Map Address (M.Map Word256 Word256),
    erException          :: Maybe VMException
    } deriving (Show)
