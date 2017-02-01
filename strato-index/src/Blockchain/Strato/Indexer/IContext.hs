{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TemplateHaskell      #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Blockchain.Strato.Indexer.IContext (
  IContext(..),
  IContextM,
  runIContextM
  ) where

import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.State
import qualified Data.Text                      as T
import qualified Database.Persist.Postgresql    as SQL

import           Blockchain.DB.SQLDB
import           Blockchain.EthConf
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import qualified Database.Redis                 as Redis

import           Network.Kafka

data IContext = IContext {
    contextSQLDB        :: SQLDB,
    contextKafkaState   :: KafkaState,
    contextRedisBlockDB :: Redis.Connection
}

type IContextM = StateT IContext (ResourceT (LoggingT IO))

instance HasSQLDB IContextM where
  getSQLDB = contextSQLDB <$> get

instance HasKafkaState IContextM where
    getKafkaState = contextKafkaState <$> get
    putKafkaState ks = do
        st <- get
        put st { contextKafkaState = ks }

instance RBDB.HasRedisBlockDB IContextM where
    getRedisBlockDB = contextRedisBlockDB <$> get

pgPoolSize :: Int
pgPoolSize = 20

runIContextM :: KafkaClientId -> IContextM a -> LoggingT IO a
runIContextM cid f = do
    $logInfoS "runIContextM" . T.pack $ "Creating PG connection pool of size " ++ show pgPoolSize
    sqldb <- runNoLoggingT  $ SQL.createPostgresqlPool connStr' pgPoolSize
    redis <- liftIO $ Redis.checkedConnect lookupRedisBlockDBConfig
    (ret, _) <- runResourceT $ runStateT f (IContext sqldb (mkConfiguredKafkaState cid) redis)
    $logInfoS "runIContextM" "runIContextM complete, returning"
    return ret
