{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE GADTs                 #-}
{-# LANGUAGE MultiParamTypeClasses #-}

module Blockchain.DB.SQLDB (
  HasSQLDB(..),
  SQLDB,
  sqlQuery,
  runPostgresConn,
  createPostgresqlPool',
  withGlobalSQLPool
  ) where

import           Control.Monad.IO.Class
import           Control.Monad.Logger         (MonadLogger, runNoLoggingT)
import           Control.Monad.Trans.Control
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.Resource
import qualified Database.Persist.Postgresql  as SQL

import           Data.IORef
import           System.IO.Unsafe             (unsafePerformIO)

import           Blockchain.EthConf           (connStr)

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

globalSQLPool :: IORef SQLDB
globalSQLPool = unsafePerformIO $ do
  pool <- runNoLoggingT $ createPostgresqlPool' connStr 5
  newIORef pool
{-# NOINLINE globalSQLPool #-}

withGlobalSQLPool :: (MonadIO m) => (SQLDB -> m a) -> m a
withGlobalSQLPool m = liftIO (readIORef globalSQLPool) >>= m
