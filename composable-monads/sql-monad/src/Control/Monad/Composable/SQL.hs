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

data SQLEnv =
  SQLEnv {
    pool :: SQLDB
  }

createSQLEnv :: MonadUnliftIO m =>
                m SQLEnv
createSQLEnv = 
  fmap SQLEnv $ runNoLoggingT $ createPostgresqlPool connStr 20  


runSQLMUsingEnv :: SQLEnv -> SQLM m a -> m a
runSQLMUsingEnv env f = 
  runReaderT f $ pool env



runSQLM :: MonadUnliftIO m => SQLM m a -> m a
runSQLM f = flip runSQLMUsingEnv f =<< createSQLEnv
