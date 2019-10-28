{-# OPTIONS_GHC -fno-warn-orphans #-}
module Slipstream.Data.Globals where

import Control.DeepSeq
import Data.Cache.LRU
import qualified Data.HashMap.Strict as HM
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import Data.Text
import Data.Int (Int32)
import GHC.Generics

import BlockApps.Solidity.Value
import BlockApps.Solidity.Xabi     (ContractDetails(..))
import BlockApps.Ethereum
import Slipstream.Data.GlobalsColdStorage (Handle)

instance NFData (LRU key val) where
  rnf = (`seq` ()) -- LRU is already pretty strict


data Globals = Globals { createdContracts :: S.Set CodePtr -- list of contacts with a table
                       , historyList :: S.Set CodePtr
                       , noIndexList :: S.Set CodePtr
                       , functionHistoryList :: S.Set CodePtr
                       , solidVMABIs :: HM.HashMap SHA (M.Map Text (Int32, ContractDetails))
                       , contractStates :: LRU (Address, Maybe ChainId) [(Text, Value)]
                       , csHandle :: Handle
                       } deriving (Generic, NFData)
