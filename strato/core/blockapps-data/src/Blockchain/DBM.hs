{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeFamilies #-}

module Blockchain.DBM
  ( DBs (..),
    DebugMode (..),
    openDBs,
  )
where

import BlockApps.Logging (runNoLoggingT)
import Blockchain.DB.SQLDB
import Blockchain.EthConf
import Control.Monad (when)
import Control.Monad.IO.Unlift

data DebugMode = Log | Fail deriving (Eq)

data DBs = DBs
  { -- | The eth database: strato-p2p reads block data (the genesis hash at
    -- every handshake) through it, as on develop.
    sqlDB' :: SQLDB,
    -- | The peer store of strato-p2p and ethereum-discover (p_peer,
    -- sync_task): the SQLite file when 'peerSqlitePath' is set, else this
    -- cell's own database when 'peerDbConfig' is set (created on first
    -- use), else the eth pool itself, so a monolith opens exactly the
    -- connections it did before.
    peerDB' :: SQLDB
  }

openDBs :: MonadUnliftIO m => m DBs
openDBs = do
  eth <- runNoLoggingT $ createPostgresqlPool connStr 20
  peers <-
    if peerStoreIsSqlite
      then runNoLoggingT $ createPeerStorePool 20
      else case peerDbConfig ethConf of
        Nothing -> return eth
        Just conf -> do
          liftIO $ ensureDatabaseExists conf
          runNoLoggingT $ createPeerStorePool 20
  -- The 'HasPeerDB' instance reaches the peer store through the global
  -- pool. On SQLite that must be this same pool: a second pool of
  -- connections to the same file only adds writers contending for the
  -- one write lock, and its own five-connection queue for callers to
  -- pile up in when a write is stuck.
  when peerStoreIsSqlite $ liftIO $ setGlobalSQLPool peers
  return DBs {sqlDB' = eth, peerDB' = peers}
