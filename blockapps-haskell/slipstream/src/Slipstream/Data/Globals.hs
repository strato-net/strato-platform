module Slipstream.Data.Globals where

import Control.DeepSeq
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import Data.Text
import GHC.Generics

import BlockApps.Solidity.Value
import BlockApps.Ethereum
import Slipstream.GlobalsColdStorage (Handle)

data Globals = Globals { createdContracts :: S.Set Keccak256 -- list of contacts with a table
                       , historyList :: S.Set Keccak256
                       , noIndexList :: S.Set Keccak256
                       , contractStates :: M.Map (Address, Maybe ChainId) [(Text, Value)]
                       , csHandle :: Handle
                       } deriving (Generic, NFData)
