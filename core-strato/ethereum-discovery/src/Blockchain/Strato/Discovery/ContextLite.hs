{-# LANGUAGE FlexibleContexts               #-}
{-# LANGUAGE FlexibleInstances              #-}
{-# LANGUAGE GADTs                          #-}
{-# LANGUAGE MultiParamTypeClasses          #-}
{-# LANGUAGE TypeApplications               #-}
{-# LANGUAGE TypeOperators                  #-}
{-# LANGUAGE TypeSynonymInstances           #-}
{-# LANGUAGE UndecidableInstances           #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
module Blockchain.Strato.Discovery.ContextLite
  ( ContextLite -- (..)
  , initContextLite
  , addPeer
  ) where


import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.Strato.Discovery.Data.Peer
import           Control.Monad.Change.Modify           (Accessible(..), Proxy(..))
import           Control.Monad.Reader
import           Control.Monad.IO.Unlift
import           Control.Monad.Trans.Resource
import qualified Data.Text                             as T
import qualified Database.Persist.Postgresql           as SQL

newtype ContextLite =
  ContextLite { liteSQLDB::SQLDB }

instance Monad m => Accessible SQLDB (ReaderT ContextLite m) where
  access _ = asks liteSQLDB

initContextLite :: MonadUnliftIO m => m ContextLite
initContextLite = do
  dbs <- openDBs
  return ContextLite { liteSQLDB = sqlDB' dbs }

addPeer :: HasSQLDB m =>PPeer->m (SQL.Key PPeer)
addPeer peer = do
  db <- access (Proxy @SQLDB)
  maybePeer <- getPeerByIP (T.unpack $ pPeerIp peer)
  runResourceT $
    SQL.runSqlPool (actions maybePeer) db
  where actions mp = case mp of
            Nothing -> SQL.insert peer
            Just peer'-> do
              SQL.update (SQL.entityKey peer') [PPeerPubkey SQL.=.pPeerPubkey peer]
              return (SQL.entityKey peer')

getPeerByIP :: HasSQLDB m =>String->m (Maybe (SQL.Entity PPeer))
getPeerByIP ip = do
  db <- access (Proxy @SQLDB)
  entPeer <- runResourceT $ SQL.runSqlPool actions db

  case entPeer of
    []  -> return Nothing
    lst -> return $ Just . head $ lst

  where actions = SQL.selectList [ PPeerIp SQL.==. T.pack ip ] []
