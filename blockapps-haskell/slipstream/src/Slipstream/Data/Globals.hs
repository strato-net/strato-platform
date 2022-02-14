{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Slipstream.Data.Globals (
  Globals(..),
  SlipstreamInfo(..),
  TableColumns,
  TableName(..)
  ) where

import           Control.DeepSeq
import           Data.Cache.LRU
import qualified Data.HashMap.Strict as HM
import qualified Data.Map.Strict     as M
import qualified Data.Set            as S
import           Data.Text
import           GHC.Generics

import           BlockApps.Solidity.Value
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256
import           Slipstream.Data.GlobalsColdStorage (Handle)


instance NFData (LRU key val) where
  rnf = (`seq` ()) -- LRU is already pretty strict

instance NFData (TableName) where
  rnf = (`seq` ())

data SlipstreamInfo = SlipstreamInfo {
  slipName :: Text,
  slipHash :: CodePtr
} deriving (Show, Generic, NFData)

data Globals = Globals { createdTables :: M.Map TableName TableColumns
                       , historyList :: M.Map TableName Bool
                       , createdInstances :: S.Set CodePtr -- lets us avoid an extra bloc call
                       , solidVMInfo :: HM.HashMap Keccak256 (M.Map Text SlipstreamInfo)
                       , contractStates :: LRU Account [(Text, Value)]
                       , csHandle :: Handle
                       } deriving (Generic, NFData)

data TableName = 
    IndexTableName
      { itOrganization :: Text
      , itApplication  :: Text
      , itContractName :: Text
      }
  | HistoryTableName -- technically the same as index, but logically different
      { htOrganization :: Text
      , htApplication  :: Text
      , htContractName :: Text
      }
  | EventTableName
      { etOrganization :: Text
      , etApplication  :: Text
      , etContractName :: Text
      , etEventName    :: Text
      } deriving (Show, Eq, Ord)

type TableColumns = [Text]
