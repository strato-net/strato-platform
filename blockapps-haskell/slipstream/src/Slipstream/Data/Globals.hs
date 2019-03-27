{-# OPTIONS_GHC -fno-warn-orphans #-}
module Slipstream.Data.Globals where

import Control.DeepSeq
import Data.Cache.LRU
import qualified Data.HashMap.Strict as HM
import qualified Data.Set as S
import Data.Text
import GHC.Generics

import BlockApps.Solidity.Value
import BlockApps.Ethereum
import Slipstream.Data.GlobalsColdStorage (Handle)

instance NFData (LRU key val) where
  rnf = (`seq` ()) -- LRU is already pretty strict


data Globals = Globals { createdContracts :: S.Set SHA -- list of contacts with a table
                       , historyList :: S.Set SHA
                       , noIndexList :: S.Set SHA
                       , functionHistoryList :: S.Set SHA
                       , solidVMDetails :: HM.HashMap SHA (Text, Text)
                       , contractStates :: LRU (Address, Maybe ChainId) [(Text, Value)]
                       , csHandle :: Handle
                       } deriving (Generic, NFData)
