
module Blockchain.DB.StateDB (
  StateDB,
  HasStateDB(..),
  getStateRoot
  ) where

import           Control.Monad.IO.Class

import qualified Blockchain.Database.MerklePatricia as MP

type StateDB = MP.MPDB

class MonadIO m => HasStateDB m where
  getStateDB :: m MP.MPDB
  setStateDBStateRoot :: MP.StateRoot -> m ()


getStateRoot :: HasStateDB m => m MP.StateRoot
getStateRoot = MP.stateRoot <$> getStateDB

