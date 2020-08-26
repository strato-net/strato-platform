{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Slipstream.Data.Globals where

import           Control.DeepSeq
import           Control.Lens
import           Data.Cache.LRU
import qualified Data.HashMap.Strict as HM
import qualified Data.Map.Strict     as M
import qualified Data.Set            as S
import           Data.Text
import           Data.Int (Int32)
import           GHC.Generics

import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi     (ContractDetails(..))
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256
import           Slipstream.Data.GlobalsColdStorage (Handle)



instance NFData (LRU key val) where
  rnf = (`seq` ()) -- LRU is already pretty strict


data Globals = Globals { _createdEvents :: S.Set (Text, Text) -- (contractName, eventName)
                       , _createdContracts :: S.Set CodePtr -- list of contacts with a table
                       , _createdInstances :: S.Set CodePtr -- probably redundant, but for now :)
                       , _historyList :: S.Set CodePtr
                       , _noIndexList :: S.Set CodePtr
                       , _functionHistoryList :: S.Set CodePtr
                       , _contractABIs :: HM.HashMap Keccak256 (M.Map Text (Int32, ContractDetails))
                       , _contractStates :: LRU (Address, Maybe ChainId) [(Text, Value)]
                       , _csHandle :: Handle
                       } deriving (Generic, NFData)
makeLenses ''Globals
