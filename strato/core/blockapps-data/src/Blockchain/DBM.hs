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
  return DBs {sqlDB' = eth, peerDB' = peers}
