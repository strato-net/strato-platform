{-# LANGUAGE FlexibleContexts, ConstraintKinds, GADTs #-}

module Blockchain.DB.SQLDB (
  HasSQLDB(..),
  SQLDB,
  sqlQuery,
  runPostgresConn,
  createPostgresqlPool'
  ) where

import Control.Monad.Trans.Resource
import qualified Database.Persist.Postgresql as SQL

import Control.Monad.Logger (MonadLogger)
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Control
import Control.Monad.IO.Class

type SQLDB = SQL.ConnectionPool

class (MonadResource m, MonadBaseControl IO m) => HasSQLDB m where
  getSQLDB :: m SQLDB

sqlQuery :: HasSQLDB m => SQL.SqlPersistT (ResourceT m) a->m a
sqlQuery q = do
  db <- getSQLDB
  runResourceT $
               SQL.runSqlPool q db
       
runPostgresConn :: (MonadBaseControl IO m, MonadIO m, MonadLogger m, backend ~ SQL.SqlBackend)
                => SQL.ConnectionString
                -> ReaderT backend m a
                -> m a
runPostgresConn pgConn = SQL.withPostgresqlConn pgConn . runReaderT

createPostgresqlPool' :: (MonadIO m, MonadBaseControl IO m, MonadLogger m, backend ~ SQL.SqlBackend)
                      => SQL.ConnectionString -> Int -> m SQLDB
createPostgresqlPool' = SQL.createPostgresqlPool            
