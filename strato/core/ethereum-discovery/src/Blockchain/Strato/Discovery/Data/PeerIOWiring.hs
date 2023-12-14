{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE NoDeriveAnyClass #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}


module Blockchain.Strato.Discovery.Data.PeerIOWiring where

import Blockchain.DB.SQLDB (runSqlPool, withGlobalSQLPool)
import Blockchain.Data.PersistTypes ()
import Blockchain.MiscJSON ()
import Blockchain.Strato.Discovery.Data.Peer
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Reader
import qualified Data.Text as T
import Data.Time
import qualified Database.Persist.Postgresql as SQL
import Prometheus
import UnliftIO










instance MonadIO m => Mod.Accessible AvailablePeers m where
  access _ = liftIO $ withGlobalSQLPool $ \sqldb -> do
    currentTime <- liftIO getCurrentTime
    fmap (AvailablePeers . map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerBondState SQL.==. 2, PPeerEnableTime SQL.<. currentTime] []

instance MonadIO m => A.Replaceable (IPAsText, TCPPort) ActivityState m where
  replace _ (IPAsText ip, TCPPort port) state = liftIO $ withGlobalSQLPool . runSqlPool $ do
    SQL.updateWhere
      [PPeerIp SQL.==. ip, PPeerTcpPort SQL.==. port]
      [PPeerActiveState SQL.=. fromEnum state]

{-
instance (A.Replaceable (IPAsText, TCPPort) PeerActiveThread) IO where
  replace _ (IPAsText ip, TCPPort port) activethread = withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      case activethread of
        (PeerActiveThread False) -> SQL.updateWhere [PPeerIp SQL.==. ip, PPeerTcpPort SQL.==. port]
                                                    [PPeerActiveThread SQL.=. True]
        (PeerActiveThread True)  -> SQL.updateWhere [PPeerIp SQL.==. ip, PPeerTcpPort SQL.==. port]
                                                    [PPeerActiveThread SQL.=. False]

instance (A.Replaceable (IPAsText, TCPPort) PeerActiveThreadId) IO where
  replace _ (IPAsText ip, TCPPort port) activethreadid = withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      case activethreadid of
        (PeerActiveThreadId Nothing)    -> SQL.updateWhere [PPeerIp SQL.==. ip, PPeerTcpPort SQL.==. port]
                                                           [PPeerActiveThreadId SQL.=. (Just tid)]
        (PeerActiveThreadId (Just tid)) -> SQL.updateWhere [PPeerIp SQL.==. ip, PPeerTcpPort SQL.==. port]
                                                           [PPeerActiveThreadId SQL.=. Nothing]
-}

instance MonadIO m => Mod.Accessible ActivePeers m where
  access _ = liftIO $ withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (ActivePeers . map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerActiveState SQL.==. fromEnum Active, PPeerEnableTime SQL.<. currentTime] []

instance MonadIO m => (A.Replaceable (IPAsText, UDPPort) PeerBondingState) m where
  replace _ (IPAsText ip, UDPPort port) (PeerBondingState state) = liftIO $ withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere [PPeerIp SQL.==. ip, PPeerUdpPort SQL.==. port] [PPeerBondState SQL.=. state]

instance MonadIO m => (A.Replaceable (IPAsText, TCPPort) PeerBondingState) m where
  replace _ (IPAsText ip, TCPPort port) (PeerBondingState state) = liftIO $ withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere [PPeerIp SQL.==. ip, PPeerTcpPort SQL.==. port] [PPeerBondState SQL.=. state]

instance MonadIO m => Mod.Accessible BondedPeers m where
  access _ = liftIO $ withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (BondedPeers . map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerBondState SQL.==. 2, PPeerEnableTime SQL.<. currentTime] []

instance MonadIO m => Mod.Accessible BondedPeersForUDP m where
  access _ = liftIO $ withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (BondedPeersForUDP . map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerBondState SQL.==. 2, PPeerUdpEnableTime SQL.<. currentTime] []

instance MonadIO m => Mod.Accessible UnbondedPeers m where
  access _ = liftIO $ withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (UnbondedPeers . map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerBondState SQL.==. 0, PPeerUdpEnableTime SQL.<. currentTime, PPeerEnableTime SQL.<. currentTime] []

instance MonadIO m => A.Selectable IPAsText ClosestPeers m where
  select _ (IPAsText requesterIP) = liftIO $ withGlobalSQLPool $ \sqldb ->
    fmap (Just . ClosestPeers . map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerIp SQL.!=. requesterIP, PPeerPubkey SQL.!=. Nothing] []

instance MonadIO m => A.Replaceable PPeer UdpEnableTime m where
  replace _ peer' (UdpEnableTime enableTime) = liftIO $ withGlobalSQLPool $ \sqldb -> do
    -- TODO(tim): Reenable port selection
    let peer = peer' {pPeerTcpPort = 30303}
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerUdpEnableTime SQL.=. enableTime]

instance MonadIO m => A.Replaceable PPeer TcpEnableTime m where
  replace _ peer' (TcpEnableTime enableTime) = liftIO $ withGlobalSQLPool $ \sqldb -> do
    -- TODO(tim): Reenable port selection
    let peer = peer' {pPeerTcpPort = 30303}
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerEnableTime SQL.=. enableTime]

instance MonadIO m => A.Replaceable PPeer PeerDisable m where
  replace _ peer d = liftIO $ withGlobalSQLPool $ \sqldb -> do
    let selector = thisPeer peer
    flip runSqlPool sqldb $ case d of
      ExtendPeerDisableTime (TcpEnableTime enableTime) nextDisableWindowFactor ->
        SQL.updateWhere
          selector
          [ PPeerEnableTime SQL.=. enableTime,
            PPeerUdpEnableTime SQL.=. enableTime,
            PPeerNextDisableWindowSeconds SQL.*=. nextDisableWindowFactor
          ]
      SetPeerDisableTime (TcpEnableTime enableTime) nextDisableWindow disableExpiration ->
        SQL.updateWhere
          selector
          [ PPeerEnableTime SQL.=. enableTime,
            PPeerUdpEnableTime SQL.=. enableTime,
            PPeerNextDisableWindowSeconds SQL.=. nextDisableWindow,
            PPeerDisableExpiration SQL.=. disableExpiration
          ]

instance MonadIO m => A.Replaceable PPeer PeerUdpDisable m where
  replace _ peer d = liftIO $ withGlobalSQLPool $ \sqldb -> do
    let selector = thisPeer peer
    currentTime <- liftIO getCurrentTime
    flip runSqlPool sqldb $ case d of
      ExtendPeerUdpDisableTime (UdpEnableTime enableTime) nextDisableWindowFactor ->
        SQL.updateWhere
          selector
          [ PPeerUdpEnableTime SQL.=. enableTime,
            PPeerNextUdpDisableWindowSeconds SQL.*=. nextDisableWindowFactor
          ]
      SetPeerUdpDisableTime (UdpEnableTime enableTime) nextDisableWindow disableExpiration ->
        SQL.updateWhere
          selector
          [ PPeerUdpEnableTime SQL.=. enableTime,
            PPeerNextUdpDisableWindowSeconds SQL.=. nextDisableWindow,
            PPeerDisableExpiration SQL.=. disableExpiration
          ]
      ResetPeerUdpDisable ->
        SQL.updateWhere
          selector
          [ PPeerUdpEnableTime SQL.=. currentTime,
            PPeerNextUdpDisableWindowSeconds SQL.=. 5,
            PPeerDisableExpiration SQL.=. currentTime
          ]

instance MonadIO m => A.Replaceable PPeer T.Text m where
  replace _ peer' exception = liftIO $ withGlobalSQLPool $ \sqldb -> do
    let peer = peer' {pPeerTcpPort = 30303}
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerDisableException SQL.=. exception]

instance MonadIO m => A.Replaceable T.Text PPeer m where
  replace _ message peer = liftIO $ withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerLastMsg SQL.=. message]


instance (MonadUnliftIO m, MonadMonitor m, HasPeerDB m) => ((IPAsText, TCPPort) `A.Alters` ActivityState) m where
  lookup _ _ = error "lookup ActivityState undefined for ContextM"
  insert _ (IPAsText i, TCPPort p) = void . setPeerActiveState i p
  delete _ _ = error "lookup ActivityState undefined for ContextM"

