{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DerivingStrategies    #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE GADTs                 #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE NoDeriveAnyClass      #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeFamilies          #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE UndecidableInstances  #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}


module Blockchain.Strato.Discovery.Data.PeerIOWiring where

import           Blockchain.Data.PersistTypes          ()
import           Blockchain.DB.SQLDB                   (runSqlPool,
                                                        withGlobalSQLPool)
import           Blockchain.MiscJSON                   ()
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.Host
import           Blockchain.Strato.Model.Keccak256     (zeroHash)
import           Control.Monad                         (void)
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Reader
import           Crypto.Types.PubKey.ECC               (Point)
import           Data.IP
import qualified Data.Text                             as T
import           Data.Time
import qualified Database.Esqueleto.Experimental       as E
import qualified Database.Persist.Postgresql           as SQL
import           Numeric.Natural
import           Prometheus
import           SelectAccessible                      ()
import           UnliftIO










instance {-# OVERLAPPING #-} Mod.Accessible AvailablePeers IO where
  access _ = withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (AvailablePeers . map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerBondState SQL.==. 2, PPeerUdpEnableTime SQL.<. currentTime] []

instance {-# OVERLAPPING #-} A.Replaceable (Host, TCPPort) ActivityState IO where
  replace _ (host, TCPPort port) state = withGlobalSQLPool . runSqlPool $ do
    SQL.updateWhere
      [PPeerHost SQL.==. host, PPeerTcpPort SQL.==. port]
      [PPeerActiveState SQL.=. fromEnum state]

instance {-# OVERLAPPING #-} Mod.Accessible ActivePeers IO where
  access _ = withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (ActivePeers . map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerActiveState SQL.==. fromEnum Active, PPeerEnableTime SQL.<. currentTime] []

instance {-# OVERLAPPING #-} A.Replaceable (Host, Point) PeerBondingState IO where
  replace _ (host, point) (PeerBondingState state) = withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere [PPeerHost SQL.==. host, PPeerPubkey SQL.==. Just point] [PPeerBondState SQL.=. state]

instance {-# OVERLAPPING #-} A.Replaceable PPeer Point IO where
  replace _ peer point = withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere [PPeerHost SQL.==. pPeerHost peer] [PPeerPubkey SQL.=. Just point]

instance {-# OVERLAPPING #-} A.Selectable (Host, Point) PeerBondingState IO where
  select _ (host, point) = withGlobalSQLPool $ \sqldb -> do
    fmap (fmap $ PeerBondingState . pPeerBondState . SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectFirst [PPeerHost SQL.==. host, PPeerPubkey SQL.==. Just point] []

instance {-# OVERLAPPING #-} (A.Replaceable PPeer PeerLastBestBlockHash) IO where
  replace _ p (PeerLastBestBlockHash h) = withGlobalSQLPool $ runSqlPool $
    SQL.updateWhere [PPeerHost SQL.==. pPeerHost p, PPeerPubkey SQL.==. pPeerPubkey p] [PPeerLastBestBlockHash SQL.=. h]

instance {-# OVERLAPPING #-} Mod.Accessible BondedPeers IO where
  access _ = withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (BondedPeers . map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerBondState SQL.==. 2, PPeerEnableTime SQL.<. currentTime] []

instance {-# OVERLAPPING #-} Mod.Accessible BondedPeersForUDP IO where
  access _ = withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (BondedPeersForUDP . map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerBondState SQL.==. 2, PPeerUdpEnableTime SQL.<. currentTime, PPeerLastBestBlockHash SQL.!=. zeroHash] []

instance {-# OVERLAPPING #-} Mod.Accessible UnbondedPeersForUDP IO where
  access _ = withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (UnbondedPeersForUDP . map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerBondState SQL.==. 0, PPeerUdpEnableTime SQL.<. currentTime] []

instance {-# OVERLAPPING #-} A.Selectable (Point, Natural) ClosestPeers IO where
  select _ (point, limit) = withGlobalSQLPool $ \sqldb -> do
    fmap (Just . ClosestPeers . map SQL.entityVal) $
      flip runSqlPool sqldb $ do
        lowers <- E.select $ do
          peer <- E.from $ E.table @PPeer
          E.where_ (       (peer E.^. PPeerPubkey E.>. E.val (Just point))
                     E.&&. (peer E.^. PPeerBondState E.==. E.val 2)
                     E.&&. (peer E.^. PPeerLastBestBlockHash E.!=. E.val zeroHash)
                   )
          E.orderBy [E.asc $ peer E.^. PPeerPubkey]
          E.limit (fromIntegral limit * 2)
          pure peer
        highers <- E.select $ do
          peer <- E.from $ E.table @PPeer
          E.where_ (       (peer E.^. PPeerPubkey E.<. E.val (Just point))
                     E.&&. (peer E.^. PPeerBondState E.==. E.val 2)
                     E.&&. (peer E.^. PPeerLastBestBlockHash E.!=. E.val zeroHash)
                   )
          E.orderBy [E.desc $ peer E.^. PPeerPubkey]
          E.limit (fromIntegral limit * 2)
          pure peer
        let zipAll (a:as) (b:bs) = [a, b] ++ zipAll as bs
            zipAll as [] = as
            zipAll [] bs = bs
        pure . take (fromIntegral limit) $ zipAll lowers highers

instance {-# OVERLAPPING #-} A.Replaceable PPeer UdpEnableTime IO where
  replace _ peer (UdpEnableTime enableTime) = withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerUdpEnableTime SQL.=. enableTime]

instance {-# OVERLAPPING #-} A.Replaceable PPeer IP IO where
  replace _ peer ip = withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerIp SQL.=. Just ip]

instance {-# OVERLAPPING #-} A.Replaceable PPeer TcpEnableTime IO where
  replace _ peer (TcpEnableTime enableTime) = withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerEnableTime SQL.=. enableTime]

instance {-# OVERLAPPING #-} A.Replaceable PPeer PeerDisable IO where
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

instance {-# OVERLAPPING #-} A.Replaceable PPeer PeerUdpDisable IO where
  replace _ peer d = withGlobalSQLPool $ \sqldb -> do
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

instance {-# OVERLAPPING #-} A.Replaceable PPeer T.Text IO where
  replace _ peer exception = withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerDisableException SQL.=. exception]

instance {-# OVERLAPPING #-} A.Replaceable T.Text PPeer IO where
  replace _ message peer = withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerLastMsg SQL.=. message]


instance (MonadUnliftIO m, MonadMonitor m, HasPeerDB m) => ((Host, TCPPort) `A.Alters` ActivityState) m where
  lookup _ _ = error "lookup ActivityState undefined for ContextM"
  insert _ (i, TCPPort p) = void . setPeerActiveState i p
  delete _ _ = error "lookup ActivityState undefined for ContextM"

