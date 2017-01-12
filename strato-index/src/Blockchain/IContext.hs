{-# LANGUAGE OverloadedStrings, TypeSynonymInstances, FlexibleInstances, TemplateHaskell #-}

module Blockchain.IContext (
  IContext(..),
  IContextM,
  runIContextM
  ) where

import Control.Monad.Logger
import Control.Monad.IO.Class
import Control.Monad.Trans.Resource
import Control.Monad.Trans.State
import qualified Database.Persist.Postgresql as SQL
import qualified Data.Text as T

import Blockchain.DB.SQLDB
import Blockchain.EthConf

import qualified Control.Concurrent as STOP_USING_DELAY_HACKS

data IContext = IContext {
    contextSQLDB :: SQLDB
}

type IContextM = StateT IContext (ResourceT (LoggingT IO))

instance HasSQLDB IContextM where
  getSQLDB = contextSQLDB <$> get

pgPoolSize :: Int
pgPoolSize = 20

runIContextM :: IContextM a -> LoggingT IO a
runIContextM f = do
    $logInfoS "runIContextM" . T.pack $ "Creating PG connection pool of size " ++ show pgPoolSize
    sqldb <- runNoLoggingT  $ SQL.createPostgresqlPool connStr' pgPoolSize
    (ret, _) <- runResourceT $ runStateT f (IContext sqldb)
    $logInfoS "runIContextM" "runIContextM complete, returning"
    return ret
