{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}

{-# OPTIONS -fno-warn-orphans #-}

module SQLM where

import qualified Control.Monad.Change.Modify as Mod
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.Trans.Reader

import           Database.Persist.Postgresql

import           Blockchain.DB.SQLDB
  
type SQLM = ReaderT SQLDB IO

instance Mod.Accessible SQLDB SQLM where
  access _ = ask

runSQLM :: ConnectionString -> SQLM a -> IO a
runSQLM connStr f = do
  conn <- liftIO $ runNoLoggingT $ createPostgresqlPool connStr 20
  runReaderT f conn

