{-# OPTIONS_GHC -fno-warn-orphans #-}
module Slipstream.Data.Globals where

import           Control.DeepSeq
import           Data.Cache.LRU
import qualified Data.HashMap.Strict as HM
import qualified Data.Map.Strict     as M
import qualified Data.Set            as S
import           Data.Text
import           Data.Int (Int32)
import           GHC.Generics

import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi     (ContractDetails(..))
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256
import           Slipstream.Data.GlobalsColdStorage (Handle)



instance NFData (LRU key val) where
  rnf = (`seq` ()) -- LRU is already pretty strict


data Globals = Globals { createdEvents :: S.Set (Text, Text) -- (contractName, eventName)
                       , createdContracts :: S.Set CodePtr -- list of contacts with a table
                       , createdInstances :: S.Set CodePtr -- probably redundant, but for now :)
                       , historyList :: S.Set CodePtr
                       , noIndexList :: S.Set CodePtr
                       , functionHistoryList :: S.Set CodePtr
                       , contractABIs :: HM.HashMap Keccak256 (M.Map Text (Int32, ContractDetails))
                       , contractStates :: LRU Account [(Text, Value)]
                       , csHandle :: Handle
                       } deriving (Generic, NFData)
