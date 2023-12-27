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

runSQLM :: (MonadUnliftIO m, MonadLoggerIO m) => SQLM m a -> m a
runSQLM f =
  PSQL.withPostgresqlPool connStr 20 (\ppool -> runReaderT f $ SQLDB ppool)

runCirrusM :: (MonadUnliftIO m, MonadLoggerIO m) => CirrusM m a -> m a
runCirrusM f =
  PSQL.withPostgresqlPool cirrusConnStr 20 (\ppool -> runReaderT f $ CirrusDB ppool)
