{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}

module Blockchain.Strato.Indexer.IContext
    ( IContext(..)
    , IContextM
    , runIContextM
    , targetTopicName
    ) where

import qualified Control.Monad.Change.Modify     as Mod
import           Control.Monad.IO.Class
import           Blockchain.Output
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.State
import qualified Data.Text                       as T
import qualified Database.Persist.Postgresql     as SQL

import           Blockchain.DB.SQLDB
import           Blockchain.EthConf
import qualified Blockchain.Strato.RedisBlockDB  as RBDB
import qualified Database.Redis                  as Redis

import           Network.Kafka
import           Network.Kafka.Protocol

import           Blockchain.Strato.Indexer.Kafka

newtype IConfig = IConfig { contextSQLDB :: SQLDB }

data IContext = IContext
  { contextKafkaState   :: KafkaState
  , contextRedisBlockDB :: RBDB.RedisConnection
  }

type IConfigM = ReaderT IConfig (ResourceT (LoggingT IO))
type IContextM = StateT IContext IConfigM

instance Mod.Accessible SQLDB IConfigM where
  access _ = asks contextSQLDB

instance Mod.Modifiable KafkaState IContextM where
  get _   = gets contextKafkaState
  put _ k = get >>= \c -> put c{contextKafkaState = k}

instance Mod.Accessible RBDB.RedisConnection IContextM where
  access _ = contextRedisBlockDB <$> get

pgPoolSize :: Int
pgPoolSize = 20

targetTopicName :: TopicName
targetTopicName = indexEventsTopicName

runIContextM :: KafkaClientId -> IContextM a -> LoggingT IO a
runIContextM cid f = do
    $logInfoS "runIContextM" . T.pack $ "Creating PG connection pool of size " ++ show pgPoolSize
    sqldb <- runNoLoggingT  $ SQL.createPostgresqlPool connStr pgPoolSize
    redis <- liftIO $ Redis.checkedConnect lookupRedisBlockDBConfig
    ret <- fmap fst
         . runResourceT
         . flip runReaderT (IConfig sqldb)
         . flip runStateT (IContext (mkConfiguredKafkaState cid) (RBDB.RedisConnection redis))
         $ f
    $logInfoS "runIContextM" "runIContextM complete, returning"
    return ret
