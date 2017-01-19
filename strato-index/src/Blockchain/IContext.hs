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

import Network.Kafka

import qualified Control.Concurrent as STOP_USING_DELAY_HACKS

data IContext = IContext {
    contextSQLDB :: SQLDB,
    contextKafkaState :: KafkaState
}

type IContextM = StateT IContext (ResourceT (LoggingT IO))

instance HasSQLDB IContextM where
  getSQLDB = contextSQLDB <$> get

instance HasKafkaState IContextM where
    getKafkaState = contextKafkaState <$> get
    putKafkaState ks = do
        st <- get
        put st { contextKafkaState = ks }

pgPoolSize :: Int
pgPoolSize = 20

runIContextM :: KafkaClientId -> IContextM a -> LoggingT IO a
runIContextM cid f = do
    $logInfoS "runIContextM" . T.pack $ "Creating PG connection pool of size " ++ show pgPoolSize
    sqldb <- runNoLoggingT  $ SQL.createPostgresqlPool connStr' pgPoolSize
    (ret, _) <- runResourceT $ runStateT f (IContext sqldb (mkConfiguredKafkaState cid))
    $logInfoS "runIContextM" "runIContextM complete, returning"
    return ret
