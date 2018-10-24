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
    erSmorgs             :: [VMSmorgasburg],
    erException          :: Maybe VMException
    } deriving (Show, Generic)

data VMSmorgasburg = VMSmorgasburg
  { _smorgMsgSender   :: Address
  , _smorgOwner       :: Address
  , _smorgOrigin      :: Address
  , _smorgGasPrice    :: Integer
  , _smorgInputData   :: B.ByteString
  , _smorgValue       :: Integer
  , _smorgReturn      :: Maybe B.ByteString
  , _smorgStorageDiff :: M.Map Word256 Word256
  } deriving (Show, Generic)
makeLenses ''VMSmorgasburg

instance NFData ExecResults
instance NFData VMSmorgasburg
