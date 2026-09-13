{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

module Control.Monad.Composable.SQL where

import Blockchain.DB.SQLDB
import Blockchain.EthConf
import Control.Monad.Composable.Base
import Control.Monad.IO.Unlift
import Control.Monad.Logger
import Control.Monad.Reader
import qualified Database.Persist.Postgresql as PSQL

type SQLM = ReaderT SQLDB

type HasSQL m = (MonadIO m, MonadUnliftIO m, AccessibleEnv SQLDB m)

type CirrusM = ReaderT CirrusDB

type HasCirrus m = HasCirrusDB m

-- | Run against a pool that lives only for the duration of the action.
-- Fine for a long-lived main loop; wrong for a per-request handler, which
-- should hold a pool created once with 'createSQLDB' and use 'runSQLMWith'.
runSQLM :: (MonadUnliftIO m, MonadLoggerIO m) => SQLM m a -> m a
runSQLM f =
  PSQL.withPostgresqlPool connStr 20 (\ppool -> runReaderT f $ sqlDB ppool)

runCirrusM :: (MonadUnliftIO m, MonadLoggerIO m) => CirrusM m a -> m a
runCirrusM f =
  PSQL.withPostgresqlPool cirrusConnStr 20 (\ppool -> runReaderT f $ CirrusDB ppool)

-- | Process-wide pools for the eth and cirrus databases, sized by the caller.
-- Connections are opened lazily, so creating these before Postgres is
-- reachable is harmless.
createSQLDB :: (MonadUnliftIO m, MonadLoggerIO m) => Int -> m SQLDB
createSQLDB n
  | readerConnStr == connStr = sqlDB <$> PSQL.createPostgresqlPool connStr n
  | otherwise = SQLDB <$> PSQL.createPostgresqlPool readerConnStr n <*> PSQL.createPostgresqlPool connStr n

createCirrusDB :: (MonadUnliftIO m, MonadLoggerIO m) => Int -> m CirrusDB
createCirrusDB n = CirrusDB <$> PSQL.createPostgresqlPool cirrusConnStr n

runSQLMWith :: SQLDB -> SQLM m a -> m a
runSQLMWith = flip runReaderT

runCirrusMWith :: CirrusDB -> CirrusM m a -> m a
runCirrusMWith = flip runReaderT
