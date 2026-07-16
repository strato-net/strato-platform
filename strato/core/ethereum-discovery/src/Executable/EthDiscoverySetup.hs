{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}

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
import Database.Persist.Postgresql

setup :: (MonadLoggerIO m, MonadUnliftIO m) => [String] -> m ()
setup = withPostgresqlConn connStr . setupSQL

setupSQL :: (MonadLoggerIO m, MonadUnliftIO m) => [String] -> SqlBackend -> m ()
setupSQL nodes = runSqlConn $ do
  runMigration migrateAll

  -- Only insert bootnodes if peer table is empty (avoids overwriting discovered peer data)
  existingPeer <- selectFirst [] []
  when (isNothing (existingPeer :: Maybe (Entity PPeer))) $ do
    logInfoN $ T.pack $ "Inserting " ++ show (length nodes) ++ " bootnodes"
    let port' = discoveryPort $ discoveryConfig ethConf
        udpPort = UDPPort port'
        tcpPort = TCPPort port' -- TODO: where do we get the TCP port from?
    void . insert =<< mkPeer Nothing (Host "127.0.0.1") (Just "127.0.0.1") udpPort tcpPort
    forM_ nodes $ \node -> do
      peer <- mkPeer Nothing (Host $ T.pack node) Nothing (UDPPort 30303) (TCPPort 30303)
      void $ insert peer
