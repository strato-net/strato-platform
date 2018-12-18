{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE GADTs                #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
module Blockchain.Strato.Discovery.ContextLite
  ( ContextLite -- (..)
  , initContextLite
  , addPeer
  ) where


import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.Strato.Discovery.Data.Peer
import           Control.Monad.Reader
import           Control.Monad.IO.Unlift
import           Control.Monad.Trans.Resource
import qualified Data.Text                             as T
import qualified Database.Persist.Postgresql           as SQL

newtype ContextLite =
  ContextLite { liteSQLDB::SQLDB }

instance  MonadUnliftIO m  => HasSQLDB (ReaderT ContextLite m) where
  getSQLDB = asks liteSQLDB

initContextLite :: (MonadResource m, MonadUnliftIO m) => m ContextLite
initContextLite = do
  dbs <- openDBs
  return ContextLite { liteSQLDB = sqlDB' dbs }

addPeer :: (HasSQLDB m, MonadResource m)=>PPeer->m (SQL.Key PPeer)
addPeer peer = do
  db <- getSQLDB
  maybePeer <- getPeerByIP (T.unpack $ pPeerIp peer)
  runResourceT $
    SQL.runSqlPool (actions maybePeer) db
  where actions mp = case mp of
            Nothing -> SQL.insert peer
            Just peer'-> do
              SQL.update (SQL.entityKey peer') [PPeerPubkey SQL.=.pPeerPubkey peer]
              return (SQL.entityKey peer')

getPeerByIP :: (HasSQLDB m, MonadResource m)=>String->m (Maybe (SQL.Entity PPeer))
getPeerByIP ip = do
  db <- getSQLDB
  entPeer <- runResourceT $ SQL.runSqlPool actions db

  case entPeer of
    []  -> return Nothing
    lst -> return $ Just . head $ lst

  where actions = SQL.selectList [ PPeerIp SQL.==. T.pack ip ] []
