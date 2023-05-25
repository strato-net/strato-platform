{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

module           Control.Monad.Composable.SQL where


import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
import           Control.Monad.Reader

import           Blockchain.DB.SQLDB

import           Blockchain.EthConf
import           qualified Database.Persist.Postgresql as PSQL

type SQLM = ReaderT SQLDB

type HasSQL m = HasSQLDB m

runSQLM :: (MonadUnliftIO m, MonadLoggerIO m) => SQLM m a -> m a
runSQLM f =
  PSQL.withPostgresqlPool connStr 20 (\ppool -> runReaderT f $ SQLDB ppool)
