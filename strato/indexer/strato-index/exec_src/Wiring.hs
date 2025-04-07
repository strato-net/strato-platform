{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}


module Wiring where

import Blockchain.BlockDB
import Blockchain.DBM
import Blockchain.Data.BlockDB
import Blockchain.Data.Transaction (insertTX)
import Blockchain.DB.SQLDB
import Blockchain.Model.SyncState
import Blockchain.Model.WrappedBlock
import Blockchain.Strato.Indexer.IContext
import Blockchain.Strato.Model.Keccak256
import Blockchain.SyncDB
import Control.Exception
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Redis
import Control.Monad.IO.Class
import qualified Data.Map.Strict as M
import SelectAccessible ()

instance HasSQLDB m => (Keccak256 `A.Alters` API OutputTx) m where
  lookup _ _ = liftIO . throwIO $ Lookup "API" "Keccak256" "OutputTx"
  delete _ _ = liftIO . throwIO $ Delete "API" "Keccak256" "OutputTx"
  insert _ _ (API OutputTx {..}) = void $ insertTX Log otOrigin Nothing [otBaseTx]

instance HasSQLDB m => (Keccak256 `A.Alters` API OutputBlock) m where
  lookup _ _ = liftIO . throwIO $ Lookup "API" "Keccak256" "OutputBlock"
  delete _ _ = liftIO . throwIO $ Delete "API" "Keccak256" "OutputBlock"
  insert _ _ (API ob) = void $ putBlocks [outputBlockToBlockRetainPayloads ob] False
  insertMany _ =
    void
      . flip putBlocks False
      . map (outputBlockToBlockRetainPayloads . unAPI)
      . M.elems

instance (MonadIO m, HasRedis m) => Mod.Modifiable (P2P BestBlock) m where
  get _ = liftIO . throwIO $ Lookup "P2P" "()" "BestBlock"
  put _ (P2P (BestBlock s n)) = void . execRedis $ putBestBlockInfo s n

instance (MonadIO m, HasRedis m) => (Keccak256 `A.Alters` P2P OutputBlock) m where
  lookup _ _ = liftIO . throwIO $ Lookup "P2P" "Keccak256" "OutputBlock"
  delete _ _ = liftIO . throwIO $ Delete "P2P" "Keccak256" "OutputBlock"
  insert _ _ =
    void
      . execRedis
      . putBlock
      . unP2P

