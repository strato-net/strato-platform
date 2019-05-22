{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}

module Blockchain.Strato.Indexer.IContext
    ( IContext(..)
    , IContextM
    , IndexerBestBlockInfo(..)
    , runIContextM
    , getIndexerBestBlockInfo
    , putIndexerBestBlockInfo
    , targetTopicName
    , unIBBI
    , reIBBI
    ) where

import qualified Control.Monad.Change.Modify     as Mod
import           Control.Monad.IO.Class
import           Blockchain.Output
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.State
import           Data.Int                        (Int64)
import qualified Data.Text                       as T
import qualified Database.Persist.Postgresql     as SQL

import           Blockchain.Data.DataDefs        (BlockDataRef, Key (BlockDataRefKey))
import           Blockchain.DB.SQLDB
import           Blockchain.EthConf
import qualified Blockchain.Strato.RedisBlockDB  as RBDB
import qualified Database.Redis                  as Redis

import           Network.Kafka
import           Network.Kafka.Protocol

import           Blockchain.Strato.Indexer.Kafka

newtype IConfig = IConfig { contextSQLDB :: SQLDB }

data IContext = IContext {
    contextKafkaState   :: KafkaState,
    contextRedisBlockDB :: RBDB.RedisConnection,
    contextBestBlock    :: IndexerBestBlockInfo
}

type IConfigM = ReaderT IConfig (ResourceT (LoggingT IO))
type IContextM = StateT IContext IConfigM

newtype IndexerBestBlockInfo = IndexerBestBlockInfo (SQL.Key BlockDataRef)
    deriving (Eq, Ord, Read, Show)

instance HasSQLDB IConfigM where
  getSQLDB = asks contextSQLDB

instance Mod.Modifiable KafkaState IContextM where
  get _   = gets contextKafkaState
  put _ k = get >>= \c -> put c{contextKafkaState = k}

instance Mod.Accessible RBDB.RedisConnection IContextM where
  access _ = contextRedisBlockDB <$> get

getIndexerBestBlockInfo :: IContextM IndexerBestBlockInfo
getIndexerBestBlockInfo = contextBestBlock <$> get

putIndexerBestBlockInfo :: IndexerBestBlockInfo -> IContextM ()
putIndexerBestBlockInfo new = do
    ctx <- get
    put ctx { contextBestBlock = new }

pgPoolSize :: Int
pgPoolSize = 20

targetTopicName :: TopicName
targetTopicName = indexEventsTopicName

-- todo: Database.Persist.Postgresql.SqlBackendKey appears to be an Int64 under the hood. Need to verify.
unIBBI :: IndexerBestBlockInfo -> Int64
unIBBI (IndexerBestBlockInfo (BlockDataRefKey k)) = fromIntegral k

reIBBI :: Int64 -> IndexerBestBlockInfo
reIBBI = IndexerBestBlockInfo . BlockDataRefKey . fromIntegral

runIContextM :: KafkaClientId -> IContextM a -> LoggingT IO a
runIContextM cid f = do
    $logInfoS "runIContextM" . T.pack $ "Creating PG connection pool of size " ++ show pgPoolSize
    sqldb <- runNoLoggingT  $ SQL.createPostgresqlPool connStr pgPoolSize
    redis <- liftIO $ Redis.checkedConnect lookupRedisBlockDBConfig
    (ret, _) <- runResourceT
              . flip runReaderT (IConfig sqldb)
              . flip runStateT (IContext (mkConfiguredKafkaState cid)
                                         (RBDB.RedisConnection redis)
                                         (reIBBI 0))
              $ f
    $logInfoS "runIContextM" "runIContextM complete, returning"
    return ret
