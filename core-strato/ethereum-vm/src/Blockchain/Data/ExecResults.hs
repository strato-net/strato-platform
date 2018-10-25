{-# LANGUAGE DeriveGeneric   #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Data.ExecResults where

import           Control.DeepSeq
import           Control.Lens
import qualified Data.ByteString         as B
import qualified Data.Map.Strict         as M
import           GHC.Generics

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
    erDetails             :: [VMDetails],
    erException          :: Maybe VMException
    } deriving (Show, Generic)

data VMDetails = VMDetails
  { _detailMsgSender   :: Address
  , _detailOwner       :: Address
  , _detailOrigin      :: Address
  , _detailGasPrice    :: Integer
  , _detailInputData   :: B.ByteString
  , _detailValue       :: Integer
  , _detailReturn      :: Maybe B.ByteString
  , _detailStorageDiff :: M.Map Word256 Word256
  } deriving (Show, Generic)
makeLenses ''VMDetails

instance NFData ExecResults
instance NFData VMDetails
