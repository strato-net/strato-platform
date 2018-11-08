module Slipstream.Data.Globals where

import qualified Data.Map.Strict as M
import qualified Data.Set as S
import Data.Default
import Data.Text

import BlockApps.Solidity.Value
import BlockApps.Ethereum

data Globals = Globals { createdContracts :: S.Set Keccak256 -- list of contacts with a table
                       , historyList :: S.Set Keccak256
                       , noIndexList :: S.Set Keccak256
                       , contractStates :: M.Map (Address, Maybe ChainId) [(Text, Value)]
                       }

instance Default Globals where
  def = Globals S.empty S.empty S.empty M.empty
