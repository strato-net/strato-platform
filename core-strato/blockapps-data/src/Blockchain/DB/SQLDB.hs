{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE GADTs                 #-}
{-# LANGUAGE MultiParamTypeClasses #-}

module Blockchain.DB.SQLDB
  ( HasSQLDB
  , SQLDB(..)
  , sqlQuery
  , runSqlPool
  , runPostgresConn
  , createPostgresqlPool
  , withGlobalSQLPool
  ) where

import           Control.DeepSeq
import           Control.Monad.Change.Modify  (Accessible(..), Proxy(..))
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Blockchain.Output            (MonadLogger, runNoLoggingT)
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.Resource
import           qualified Database.Persist.Sql as SQL
import           qualified Database.Persist.Postgresql as PSQL

import           Data.IORef
import           System.IO.Unsafe             (unsafePerformIO)

import           Blockchain.EthConf           (connStr)

newtype SQLDB = SQLDB { unSQLDB :: SQL.ConnectionPool }

instance NFData SQLDB where
  rnf (SQLDB db) = db `seq` ()

type HasSQLDB m = (MonadIO m, MonadUnliftIO m, Accessible SQLDB m)

sqlQuery :: HasSQLDB m => SQL.SqlPersistT (ResourceT m) a -> m a
sqlQuery q = runResourceT . SQL.runSqlPool q . unSQLDB =<< access Proxy

runSqlPool :: MonadUnliftIO m => SQL.SqlPersistT (ResourceT m) a -> SQLDB -> m a
runSqlPool q = runResourceT . SQL.runSqlPool q . unSQLDB

runPostgresConn :: (MonadUnliftIO m, MonadLogger m, backend ~ SQL.SqlBackend)
                => PSQL.ConnectionString
                -> ReaderT backend m a
                -> m a
runPostgresConn pgConn = PSQL.withPostgresqlConn pgConn . runReaderT

createPostgresqlPool :: (MonadUnliftIO m, MonadLogger m, backend ~ SQL.SqlBackend)
                     => PSQL.ConnectionString -> Int -> m SQLDB
createPostgresqlPool cString n = SQLDB <$> PSQL.createPostgresqlPool cString n

globalSQLPool :: IORef SQLDB
globalSQLPool = unsafePerformIO $ do
  pool <- runNoLoggingT $ createPostgresqlPool connStr 5
  newIORef pool
{-# NOINLINE globalSQLPool #-}

withGlobalSQLPool :: (MonadIO m) => (SQLDB -> m a) -> m a
withGlobalSQLPool m = liftIO (readIORef globalSQLPool) >>= m
