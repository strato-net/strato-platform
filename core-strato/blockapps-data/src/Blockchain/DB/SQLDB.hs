{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE GADTs                 #-}
{-# LANGUAGE MultiParamTypeClasses #-}

module Blockchain.DB.SQLDB (
  HasSQLDB(..),
  WrapsSQLDB(..),
  SQLDB,
  sqlQuery,
  runPostgresConn,
  createPostgresqlPool',
  withGlobalSQLPool
  ) where

import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Blockchain.Output            (MonadLogger, runNoLoggingT)
import           Control.Monad.Trans.Class
import           Control.Monad.Trans.Identity
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.Resource
import           qualified Database.Persist.Sql as SQL
import           qualified Database.Persist.Postgresql as PSQL

import           Data.IORef
import           System.IO.Unsafe             (unsafePerformIO)

import           Blockchain.EthConf           (connStr)

type SQLDB = SQL.ConnectionPool

class (MonadIO m, MonadUnliftIO m) => HasSQLDB m where
  getSQLDB :: m SQLDB

class HasSQLDB m => WrapsSQLDB t m where
  runWithSQL :: m a -> (t m) a

instance (HasSQLDB m) => WrapsSQLDB IdentityT m where
  runWithSQL = lift

sqlQuery :: HasSQLDB m => SQL.SqlPersistT (ResourceT m) a->m a
sqlQuery q = do
  db <- getSQLDB
  runResourceT . SQL.runSqlPool q $ db

runPostgresConn :: (MonadUnliftIO m, MonadLogger m, backend ~ SQL.SqlBackend)
                => PSQL.ConnectionString
                -> ReaderT backend m a
                -> m a
runPostgresConn pgConn = PSQL.withPostgresqlConn pgConn . runReaderT

createPostgresqlPool' :: (MonadUnliftIO m, MonadLogger m, backend ~ SQL.SqlBackend)
                      => PSQL.ConnectionString -> Int -> m SQLDB
createPostgresqlPool' = PSQL.createPostgresqlPool

globalSQLPool :: IORef SQLDB
globalSQLPool = unsafePerformIO $ do
  pool <- runNoLoggingT $ createPostgresqlPool' connStr 5
  newIORef pool
{-# NOINLINE globalSQLPool #-}

withGlobalSQLPool :: (MonadIO m) => (SQLDB -> m a) -> m a
withGlobalSQLPool m = liftIO (readIORef globalSQLPool) >>= m
