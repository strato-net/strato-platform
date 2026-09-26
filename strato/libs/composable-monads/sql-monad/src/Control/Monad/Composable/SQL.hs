{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

module Control.Monad.Composable.SQL where

import Blockchain.DB.SQLDB
import Blockchain.EthConf
import Control.Monad.Composable.Base
import Control.Monad.IO.Unlift
import qualified Database.Persist.Postgresql as PSQL

type SQLM es = Eff (SQLDB ': es)

type HasSQL m = (MonadIO m, MonadUnliftIO m, AccessibleEnv SQLDB m)

type CirrusM es = Eff (CirrusDB ': es)

type HasCirrus m = HasCirrusDB m

runSQLM :: (Logger :> es) => SQLM es a -> Eff es a
runSQLM f =
  PSQL.withPostgresqlPool connStr 20 (\ppool -> provide (SQLDB ppool) f)

runCirrusM :: (Logger :> es) => CirrusM es a -> Eff es a
runCirrusM f =
  PSQL.withPostgresqlPool cirrusConnStr 20 (\ppool -> provide (CirrusDB ppool) f)
