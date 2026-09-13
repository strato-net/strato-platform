{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators    #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}

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
    peerStoreIsSqlite,
    createPeerStorePool,
    withPeerStoreConn,
    runPeerStoreMigration,
    PeerStore (..),
    HasPeerStore,
    peerQuery,
  )
where

import BlockApps.Logging (runNoLoggingT)
import Blockchain.EthConf (ethConf, peerConnStr, peerSqlitePath)
import Control.DeepSeq
import Control.Lens ((&), (.~))
import Control.Monad (forM_, when)
import Control.Monad.Composable.Base
import Control.Monad.IO.Class
import Control.Monad.IO.Unlift
import Control.Monad.Logger (MonadLoggerIO)
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import Data.IORef
import qualified Data.Text as T
import qualified Database.Persist.Postgresql as PSQL
import qualified Database.Persist.Sql as SQL
import Database.Persist.SqlBackend (getRDBMS)
import qualified Database.Persist.Sqlite as SQLITE
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
  pool <- runNoLoggingT $ createPeerStorePool 5
  newIORef pool
{-# NOINLINE globalSQLPool #-}

-- | The peer store (p_peer, sync_task) as a process environment, distinct
-- from the eth database ('SQLDB') that strato-p2p also reads block data
-- from. On a monolith both are the same Postgres pool; a cell keeps the
-- peer store in its own file or database.
newtype PeerStore = PeerStore {unPeerStore :: SQLDB}

type HasPeerStore m = (MonadIO m, MonadUnliftIO m, AccessibleEnv PeerStore m)

-- | Run against the peer store.
peerQuery :: HasPeerStore m => SQL.SqlPersistT (ResourceT m) a -> m a
peerQuery q = runResourceT . SQL.runSqlPool q . sqlWriterPool . unPeerStore =<< accessEnv

-- | Whether the peer store (p_peer, sync_task) is the SQLite file named by
-- 'peerSqlitePath' rather than Postgres at 'peerConnStr'.
peerStoreIsSqlite :: Bool
peerStoreIsSqlite = maybe False (const True) (peerSqlitePath ethConf)

-- | Connection settings for the SQLite peer store. WAL mode (persistent's
-- default) lets ethereum-discover and strato-p2p, two processes on the
-- same host, read and write the file concurrently; the busy timeout makes
-- a writer wait for the other process's transaction instead of failing.
peerSqliteInfo :: FilePath -> SQLITE.SqliteConnectionInfo
peerSqliteInfo path =
  SQLITE.mkSqliteConnectionInfo (T.pack path)
    & SQLITE.extraPragmas .~ ["PRAGMA busy_timeout = 10000"]

-- | Opens the peer store: the SQLite file when 'peerSqlitePath' is set,
-- else Postgres at 'peerConnStr' exactly as before.
createPeerStorePool :: (MonadUnliftIO m, MonadLoggerIO m) => Int -> m SQLDB
createPeerStorePool n = case peerSqlitePath ethConf of
  Just path -> sqlDB <$> SQLITE.createSqlitePoolFromInfo (peerSqliteInfo path) n
  Nothing -> createPostgresqlPool peerConnStr n

-- | One connection to the peer store, for setup steps.
withPeerStoreConn :: (MonadUnliftIO m, MonadLoggerIO m) => (SQL.SqlBackend -> m a) -> m a
withPeerStoreConn act = case peerSqlitePath ethConf of
  Just path -> SQLITE.withSqliteConnInfo (peerSqliteInfo path) act
  Nothing -> PSQL.withPostgresqlConn peerConnStr act

-- | Runs a peer-store migration. On Postgres this is persistent's
-- 'runMigration', unchanged. On SQLite only the CREATE TABLE statements
-- are taken from the migration, made idempotent, and given SQLite-legal
-- defaults where the models carry Postgres ones (sync_task's
-- @nextval('chiliad')@ and @now()@; inserts always supply those columns,
-- see "Blockchain.SyncDB"). Nothing else is applied: persistent's SQLite
-- migration rebuilds a table whose stored DDL differs from its own, and
-- it would do so on every start once the defaults differ.
runPeerStoreMigration :: MonadUnliftIO m => SQL.Migration -> SQL.SqlPersistT m ()
runPeerStoreMigration migration = do
  rdbms <- getRDBMS <$> ask
  if rdbms /= "sqlite"
    then SQL.runMigration migration
    else do
      statements <- SQL.getMigration migration
      forM_ statements $ \statement ->
        when ("CREATE TABLE" `T.isPrefixOf` statement) $
          SQL.rawExecute (sqliteCompatible statement) []
  where
    sqliteCompatible =
      T.replace "CREATE TABLE " "CREATE TABLE IF NOT EXISTS "
        . T.replace "DEFAULT nextval('chiliad')" "DEFAULT 0"
        . T.replace "DEFAULT now()" "DEFAULT CURRENT_TIMESTAMP"

withGlobalSQLPool :: (MonadIO m) => (SQLDB -> m a) -> m a
withGlobalSQLPool m = liftIO (readIORef globalSQLPool) >>= m
