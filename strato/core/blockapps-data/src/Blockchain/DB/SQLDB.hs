{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE MultiParamTypeClasses #-}

module Blockchain.DB.SQLDB
  ( HasSQLDB,
    SQLDB (..),
    sqlQuery,
    sqlQueryNoTransaction,
    runSqlPool,
    runPostgresConn,
    createPostgresqlPool,
    withGlobalSQLPool,
  )
where

import BlockApps.Logging (runNoLoggingT)
import Blockchain.EthConf (connStr)
import Control.DeepSeq
import Control.Monad.Change.Modify (Accessible (..), Proxy (..))
import Control.Monad.IO.Class
import Control.Monad.IO.Unlift
import Control.Monad.Logger (MonadLoggerIO)
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import Data.IORef
import qualified Database.Persist.Postgresql as PSQL
import qualified Database.Persist.Sql as SQL
import System.IO.Unsafe (unsafePerformIO)

newtype SQLDB = SQLDB {unSQLDB :: SQL.ConnectionPool}

instance NFData SQLDB where
  rnf (SQLDB db) = db `seq` ()

type HasSQLDB m = (MonadIO m, MonadUnliftIO m, Accessible SQLDB m)

sqlQuery :: HasSQLDB m => SQL.SqlPersistT (ResourceT m) a -> m a
sqlQuery q = runResourceT . SQL.runSqlPool q . unSQLDB =<< access Proxy

sqlQueryNoTransaction :: HasSQLDB m => SQL.SqlPersistT (ResourceT m) a -> m a
sqlQueryNoTransaction q = runResourceT . flip (SQL.runSqlPoolNoTransaction q) Nothing . unSQLDB =<< access Proxy

runSqlPool :: MonadUnliftIO m => SQL.SqlPersistT (ResourceT m) a -> SQLDB -> m a
runSqlPool q = runResourceT . SQL.runSqlPool q . unSQLDB

runPostgresConn ::
  (MonadUnliftIO m, MonadLoggerIO m, backend ~ SQL.SqlBackend) =>
  PSQL.ConnectionString ->
  ReaderT backend m a ->
  m a
runPostgresConn pgConn = PSQL.withPostgresqlConn pgConn . runReaderT

createPostgresqlPool ::
  (MonadUnliftIO m, MonadLoggerIO m) =>
  PSQL.ConnectionString ->
  Int ->
  m SQLDB
createPostgresqlPool cString n = SQLDB <$> PSQL.createPostgresqlPool cString n

globalSQLPool :: IORef SQLDB
globalSQLPool = unsafePerformIO $ do
  pool <- runNoLoggingT $ createPostgresqlPool connStr 5
  newIORef pool
{-# NOINLINE globalSQLPool #-}

withGlobalSQLPool :: (MonadIO m) => (SQLDB -> m a) -> m a
withGlobalSQLPool m = liftIO (readIORef globalSQLPool) >>= m
