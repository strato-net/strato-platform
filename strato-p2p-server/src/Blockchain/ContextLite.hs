{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.ContextLite (
  ContextMLite,
  runEthCryptMLite,
  initContextLite,
  getBlockHeaders,
  putBlockHeaders,
  addPeer,
  getPeerByIP
  ) where


import Control.Monad.IO.Class
import Control.Monad.Logger
import Control.Monad.State
import Control.Monad.Trans.Resource

import Blockchain.Context
import Blockchain.DBM
import Blockchain.DB.SQLDB
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.EthConf (lookupRedisBlockDBConfig, mkConfiguredKafkaState)

import qualified Database.Persist.Postgresql as SQL
import qualified Database.PostgreSQL.Simple as PS
import qualified Data.Text as T

import qualified Database.Redis as Redis

instance Show PS.Connection where
  show _ = "Postgres Simple Connection"

type ContextMLite = StateT Context (ResourceT (LoggingT IO))

runEthCryptMLite :: (MonadBaseControl IO m )
                 => s
                 -> StateT s (ResourceT m) a
                 -> m ()
runEthCryptMLite cxt f = void . runResourceT $ runStateT f cxt

initContextLite :: (MonadResource m, MonadIO m, MonadBaseControl IO m) => m Context
initContextLite = do
  dbs <- openDBs
  redisBDBPool <- liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  return Context { actionTimestamp = Nothing
                 , contextRedisBlockDB = redisBDBPool
                 , contextKafkaState = mkConfiguredKafkaState "strato-p2p-client"
                 , contextSQLDB = sqlDB' dbs
                 , blockHeaders=[]
                 , vmTrace=[]
                 }

addPeer :: (HasSQLDB m, MonadResource m, MonadBaseControl IO m, MonadThrow m)=>PPeer->m (SQL.Key PPeer)
addPeer peer = do
  db <- getSQLDB
  maybePeer <- getPeerByIP (T.unpack $ pPeerIp peer)
  runResourceT $
    SQL.runSqlPool (actions maybePeer) db
  where actions mp = case mp of
            Nothing -> SQL.insert peer

            Just peer'-> do
              SQL.update (SQL.entityKey peer') [PPeerPubkey SQL.=.(pPeerPubkey peer)]
              return (SQL.entityKey peer')

getPeerByIP :: (HasSQLDB m, MonadResource m, MonadBaseControl IO m, MonadThrow m)=>String->m (Maybe (SQL.Entity PPeer))
getPeerByIP ip = do
    db <- getSQLDB
    runResourceT (SQL.runSqlPool actions db) >>= \case
        [] -> return Nothing
        lst -> return . Just . head $ lst

    where actions = SQL.selectList [ PPeerIp SQL.==. T.pack ip ] []



