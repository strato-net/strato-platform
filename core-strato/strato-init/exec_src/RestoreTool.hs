{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# OPTIONS -fno-warn-unused-imports #-}
{-# OPTIONS -fno-warn-orphans #-}

import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.Trans.Control
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.Resource
import           Database.Persist.Postgresql  hiding (get)

import qualified Blockchain.BackupBlocks
import qualified Blockchain.DB.SQLDB          as SQLDB
import           Blockchain.EthConf

instance (Monad m, MonadResource m, MonadBaseControl IO m) => SQLDB.HasSQLDB (ReaderT SQLDB.SQLDB m) where
    getSQLDB = ask

main :: IO ()
main = do
    theConn <- runNoLoggingT $ SQLDB.createPostgresqlPool' connStr 10
    runResourceT $ runReaderT Blockchain.BackupBlocks.backupBlocks theConn
