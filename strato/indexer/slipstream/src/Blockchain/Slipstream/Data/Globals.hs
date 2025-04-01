{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Slipstream.Data.Globals
  ( CirrusHandle (..),
    Globals (..),
    TableColumns,
    TableName (..),
  )
where

import Blockchain.Slipstream.Data.GlobalsColdStorage (Handle)
import Blockchain.Slipstream.QueryFormatHelper
import BlockApps.Solidity.Value
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Data.Cache.LRU
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import qualified Data.Text as T
import Database.PostgreSQL.Typed (PGConnection)
import GHC.Generics
import SolidVM.Model.CodeCollection

instance NFData (LRU key val) where
  rnf = (`seq` ()) -- LRU is already pretty strict

instance NFData (TableName) where
  rnf = (`seq` ())

instance NFData CirrusHandle where
  rnf = const ()

data CirrusHandle
  = CirrusHandle {cirrusConn :: PGConnection, queriedMaps :: S.Set (T.Text, T.Text, T.Text)}
  | FakeCirrusHandle

data Globals = Globals
  { createdTables :: M.Map TableName TableColumns,
    contractStates :: LRU Address [(T.Text, Value)],
    ccMap :: LRU Keccak256 CodeCollection,
    delegateMap :: LRU Address [Address],
    coldStorageHandle :: Handle,
    cirrusHandle :: CirrusHandle
  }
  deriving (Generic, NFData)
