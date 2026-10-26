{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MultiParamTypeClasses #-}

module Executable.EthDiscoverySetup
  ( setup,
    setupSQL
  )
where

import BlockApps.Logging
import Blockchain.EthConf
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Host
import Control.Monad
import Control.Monad.IO.Unlift
import Data.Maybe (isNothing)
import qualified Data.Text as T
import Blockchain.DB.SQLDB (peerStoreIsSqlite, runPeerStoreMigration, withPeerStoreConn)
import Database.Persist.Postgresql

-- | Peers live in the peer store: the node's SQLite file when
-- 'peerSqlitePath' is set, else this cell's own database when the node
-- shares a Postgres cluster with other cores (created here on first use),
-- else the eth database.
setup :: (MonadLoggerIO m, MonadUnliftIO m) => [(String, UDPPort, TCPPort)] -> m ()
setup nodes = do
  unless peerStoreIsSqlite $ liftIO $ mapM_ ensureDatabaseExists (peerDbConfig ethConf)
  withPeerStoreConn (setupSQL nodes)

setupSQL :: (MonadLoggerIO m, MonadUnliftIO m) => [(String, UDPPort, TCPPort)] -> SqlBackend -> m ()
setupSQL nodes = runSqlConn $ do
  runPeerStoreMigration migrateAll

  -- Only insert bootnodes if peer table is empty (avoids overwriting discovered peer data)
  existingPeer <- selectFirst [] []
  when (isNothing (existingPeer :: Maybe (Entity PPeer))) $ do
    logInfoN $ T.pack $ "Inserting " ++ show (length nodes) ++ " bootnodes"
    forM_ nodes $ \(node, udpPort, tcpPort) -> do
      peer <- mkPeer Nothing (Host $ T.pack node) Nothing udpPort tcpPort
      void $ insert peer
