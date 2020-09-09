{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

module           Control.Monad.Composable.SQL where


import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
import           Control.Monad.Reader

import           Blockchain.DB.SQLDB

import           Blockchain.EthConf

type SQLM = ReaderT SQLDB

type HasSQL m = HasSQLDB m

runSQLM :: MonadUnliftIO m => SQLM m a -> m a
runSQLM f = do
  pool <- runNoLoggingT $ createPostgresqlPool connStr 20
  runReaderT f pool

