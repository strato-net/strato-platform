{-# LANGUAGE OverloadedStrings, TypeSynonymInstances, FlexibleInstances #-}

module Blockchain.IContext (
  IContext(..),
  IContextM,
  runIContextM
  ) where

import Control.Monad.Trans.Resource
import Control.Monad.Logger
import Control.Monad.Trans.State
import qualified Database.Persist.Postgresql as SQL

import Blockchain.DB.SQLDB
import Blockchain.EthConf
--import Debug.Trace

data IContext =
  IContext {
    contextSQLDB::SQLDB
    }

type IContextM = StateT IContext (ResourceT (LoggingT IO))

instance HasSQLDB IContextM where
  getSQLDB = fmap contextSQLDB get


runIContextM::IContextM a->LoggingT IO a
runIContextM f = do
  
  sqldb <-   runNoLoggingT  $ SQL.createPostgresqlPool connStr' 20

  (ret, _) <- runResourceT $ flip runStateT (IContext sqldb) $ f

  return ret
