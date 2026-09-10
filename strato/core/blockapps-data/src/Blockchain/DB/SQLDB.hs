{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators    #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE MultiParamTypeClasses #-}

module Blockchain.DB.SQLDB
  ( HasSQLDB,
    SQLDB (..),
    sqlDB,
    unSQLDB,
    sqlQueryWriter,
    HasCirrusDB,
    CirrusDB (..),
    sqlQuery,
    sqlQueryNoTransaction,
    runSqlPool,
    cirrusQuery,
    runPostgresConn,
    createPostgresqlPool,
    withGlobalSQLPool,
  )
where

import BlockApps.Logging (runNoLoggingT)
import Blockchain.EthConf (peerConnStr)
import Control.DeepSeq
import Control.Monad.Composable.Base
import Control.Monad.IO.Class
import Control.Monad.IO.Unlift
import Control.Monad.Logger (MonadLoggerIO)
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import Data.IORef
import qualified Database.Persist.Postgresql as PSQL
import qualified Database.Persist.Sql as SQL
import System.IO.Unsafe (unsafePerformIO)

-- | The eth database. Reads go to 'sqlReaderPool' and writes (and the few
-- reads that must see the latest commit, such as the API's resolve poll) to
-- 'sqlWriterPool'. Every process but the API tier builds one with 'sqlDB',
-- where both are the same pool; the API tier points the reader at a
-- replica endpoint.
data SQLDB = SQLDB
  { sqlReaderPool :: SQL.ConnectionPool,
    sqlWriterPool :: SQL.ConnectionPool
  }

-- | One pool serving reads and writes alike.
sqlDB :: SQL.ConnectionPool -> SQLDB
sqlDB p = SQLDB p p

-- | The reader pool; the historical accessor.
unSQLDB :: SQLDB -> SQL.ConnectionPool
unSQLDB = sqlReaderPool

instance NFData SQLDB where
  rnf (SQLDB r w) = r `seq` w `seq` ()

type HasSQLDB m = (MonadIO m, MonadUnliftIO m, AccessibleEnv SQLDB m)

newtype CirrusDB = CirrusDB {unCirrusDB :: SQL.ConnectionPool}

instance NFData CirrusDB where
  rnf (CirrusDB db) = db `seq` ()

type HasCirrusDB m = (MonadIO m, MonadUnliftIO m, AccessibleEnv CirrusDB m)

sqlQuery :: HasSQLDB m => SQL.SqlPersistT (ResourceT m) a -> m a
sqlQuery q = runResourceT . SQL.runSqlPool q . sqlReaderPool =<< accessEnv

-- | Run against the writer: for writes, and for reads that must not lag
-- behind the indexer (a replica may be a few hundred milliseconds behind).
sqlQueryWriter :: HasSQLDB m => SQL.SqlPersistT (ResourceT m) a -> m a
sqlQueryWriter q = runResourceT . SQL.runSqlPool q . sqlWriterPool =<< accessEnv

cirrusQuery :: HasCirrusDB m => SQL.SqlPersistT (ResourceT m) a -> m a
cirrusQuery q = runResourceT . SQL.runSqlPool q . unCirrusDB =<< accessEnv

sqlQueryNoTransaction :: HasSQLDB m => SQL.SqlPersistT (ResourceT m) a -> m a
sqlQueryNoTransaction q = runResourceT . flip (SQL.runSqlPoolNoTransaction q) Nothing . sqlWriterPool =<< accessEnv

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
createPostgresqlPool cString n = sqlDB <$> PSQL.createPostgresqlPool cString n

-- | Only ethereum-discover and strato-p2p use this pool, for the peer
-- tables, so it opens the peer store (this cell's own database when the
-- node shares a Postgres cluster with other cores).
globalSQLPool :: IORef SQLDB
globalSQLPool = unsafePerformIO $ do
  pool <- runNoLoggingT $ createPostgresqlPool peerConnStr 5
  newIORef pool
{-# NOINLINE globalSQLPool #-}

withGlobalSQLPool :: (MonadIO m) => (SQLDB -> m a) -> m a
withGlobalSQLPool m = liftIO (readIORef globalSQLPool) >>= m
