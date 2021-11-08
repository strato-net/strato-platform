{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Slipstream.Data.Globals where

import           Control.DeepSeq
import           Data.Cache.LRU
import qualified Data.HashMap.Strict as HM
import qualified Data.Map.Strict     as M
import qualified Data.Set            as S
import           Data.Text
import           GHC.Generics

import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi     (ContractDetails(..))
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256
import           Slipstream.Data.GlobalsColdStorage (Handle)


instance NFData (LRU key val) where
  rnf = (`seq` ()) -- LRU is already pretty strict

instance NFData (TableName) where
  rnf = (`seq` ())


data Globals = Globals { createdTables :: M.Map TableName TableColumns
                       , historyList :: S.Set TableName
                       , createdInstances :: S.Set CodePtr -- lets us avoid an extra bloc call
                       , contractABIs :: HM.HashMap Keccak256 (M.Map Text ContractDetails)
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
