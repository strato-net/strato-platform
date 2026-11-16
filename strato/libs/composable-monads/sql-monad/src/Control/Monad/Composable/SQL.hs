{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

module Control.Monad.Composable.SQL where

import Blockchain.DB.SQLDB
import Blockchain.EthConf
import Control.Monad.Composable.Base
import Control.Monad.IO.Unlift
import Control.Monad.Logger (MonadLoggerIO)
import qualified Database.Persist.Postgresql as PSQL

type SQLM es = Eff (SQLDB ': es)

type HasSQL m = (MonadIO m, MonadUnliftIO m, AccessibleEnv SQLDB m)

type CirrusM es = Eff (CirrusDB ': es)

type HasCirrus m = HasCirrusDB m

-- | Run against a pool that lives only for the duration of the action.
-- Fine for a long-lived main loop; wrong for a per-request handler, which
-- should hold a pool created once with 'createSQLDB' and use 'runSQLMWith'.
runSQLM :: (Logger :> es) => SQLM es a -> Eff es a
runSQLM f =
  PSQL.withPostgresqlPool connStr 20 (\ppool -> provide (sqlDB ppool) f)

runCirrusM :: (Logger :> es) => CirrusM es a -> Eff es a
runCirrusM f =
  PSQL.withPostgresqlPool cirrusConnStr 20 (\ppool -> provide (CirrusDB ppool) f)

-- | Process-wide pools for the eth and cirrus databases, sized by the caller.
-- Connections are opened lazily, so creating these before Postgres is
-- reachable is harmless.
createSQLDB :: (MonadUnliftIO m, MonadLoggerIO m) => Int -> m SQLDB
createSQLDB n
  | readerConnStr == connStr = sqlDB <$> PSQL.createPostgresqlPool connStr n
  | otherwise = SQLDB <$> PSQL.createPostgresqlPool readerConnStr n <*> PSQL.createPostgresqlPool connStr n

createCirrusDB :: (MonadUnliftIO m, MonadLoggerIO m) => Int -> m CirrusDB
createCirrusDB n = CirrusDB <$> PSQL.createPostgresqlPool cirrusConnStr n

runSQLMWith :: SQLDB -> SQLM es a -> Eff es a
runSQLMWith = provide

runCirrusMWith :: CirrusDB -> CirrusM es a -> Eff es a
runCirrusMWith = provide
