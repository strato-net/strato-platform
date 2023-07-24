{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Slipstream.Data.Globals (
  CirrusHandle(..),
  Globals(..),
  TableColumns,
  TableName(..),
  ) where

import           Control.DeepSeq
import           Data.Cache.LRU
import qualified Data.Map.Strict     as M
import qualified Data.Set            as S
import qualified Data.Text           as T 
import           GHC.Generics

import           Database.PostgreSQL.Typed (PGConnection)

import           BlockApps.Solidity.Value
import           Blockchain.Strato.Model.Account
import           Slipstream.Data.GlobalsColdStorage (Handle)


instance NFData (LRU key val) where
  rnf = (`seq` ()) -- LRU is already pretty strict

instance NFData (TableName) where
  rnf = (`seq` ())

instance NFData CirrusHandle where 
  rnf = const ()

data CirrusHandle = CirrusHandle {cirrusConn :: PGConnection, queriedMaps ::S.Set (T.Text, T.Text, T.Text)}
                  | FakeCirrusHandle

data Globals = Globals { createdTables :: M.Map TableName TableColumns
                       , contractStates :: LRU Account [(T.Text, Value)]
                       , coldStorageHandle :: Handle
                       , cirrusHandle :: CirrusHandle
                       } deriving (Generic, NFData)

data TableName = 
    IndexTableName
      { itOrganization :: T.Text
      , itApplication  :: T.Text
      , itContractName :: T.Text
      }
  | HistoryTableName -- technically the same as index, but logically different
      { htOrganization :: T.Text
      , htApplication  :: T.Text
      , htContractName :: T.Text
      }
  | EventTableName
      { etOrganization :: T.Text
      , etApplication  :: T.Text
      , etContractName :: T.Text
      , etEventName    :: T.Text
      } 
  | MappingTableName
      { mtOrganization :: T.Text
      , mtApplication  :: T.Text
      , mtContractName :: T.Text
      , mtMappingName  :: T.Text
      } 
  | AssetTableName T.Text deriving (Show, Eq, Ord)

type TableColumns = [T.Text]