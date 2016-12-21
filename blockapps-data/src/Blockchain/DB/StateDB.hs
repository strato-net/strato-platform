
module Blockchain.DB.StateDB (
  StateDB,
  HasStateDB(..),
  getStateRoot
  ) where

import Control.Monad.Trans.Resource

import qualified Blockchain.Database.MerklePatricia as MP

type StateDB = MP.MPDB

class MonadResource m=>
      HasStateDB m where
  getStateDB::Monad m=>m MP.MPDB
  setStateDBStateRoot::Monad m=>MP.StateRoot->m ()


getStateRoot::HasStateDB m=>m MP.StateRoot
getStateRoot = do
  db <- getStateDB
  return $ MP.stateRoot db

