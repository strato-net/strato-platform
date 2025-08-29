{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE UndecidableInstances  #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Discovery.Data.PeerIOWiring where

import           Blockchain.Data.PersistTypes          ()
import           Blockchain.DB.SQLDB                   (runSqlPool,
                                                        withGlobalSQLPool)
import           Blockchain.MiscJSON                   ()
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.Keccak256     (zeroHash)
import           Control.Monad.Reader
import           Data.Time
import qualified Database.Esqueleto.Experimental       as E
import qualified Database.Persist.Postgresql           as SQL
import           UnliftIO

instance MonadIO m => HasPeerDB m where
  getNumAvailablePeers = liftIO $ withGlobalSQLPool $ \sqldb -> do
    currentTime <- liftIO getCurrentTime
    flip runSqlPool sqldb $
        SQL.count [PPeerBondState SQL.==. 2, PPeerUdpEnableTime SQL.<. currentTime]

  setPeerActiveState host port state = liftIO $ withGlobalSQLPool . runSqlPool $ do
    SQL.updateWhere
      [PPeerHost SQL.==. host, PPeerTcpPort SQL.==. port]
      [PPeerActiveState SQL.=. fromEnum state]

  getActivePeers = liftIO $ withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    try $ fmap (map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerActiveState SQL.==. fromEnum Active, PPeerEnableTime SQL.<. currentTime] []

  setPeerBondingState host point state = liftIO $ withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      try $ SQL.updateWhere [PPeerHost SQL.==. host, PPeerPubkey SQL.==. Just point] [PPeerBondState SQL.=. state]

  getPeerBondingState host point = liftIO $ withGlobalSQLPool $ \sqldb -> do
    fmap (fmap $ pPeerBondState . SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectFirst [PPeerHost SQL.==. host, PPeerPubkey SQL.==. Just point] []

  getBondedPeers = liftIO $ withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    try $ fmap (map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerBondState SQL.==. 2, PPeerEnableTime SQL.<. currentTime] []

  getBondedPeersForUDP = liftIO $ withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    try $ fmap (map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerBondState SQL.==. 2, PPeerUdpEnableTime SQL.<. currentTime, PPeerLastBestBlockHash SQL.!=. zeroHash] []

  getUnbondedPeers = liftIO $ withGlobalSQLPool $ \sqldb -> do
    currentTime <- getCurrentTime
    fmap (map SQL.entityVal) $
      flip runSqlPool sqldb $
        SQL.selectList [PPeerBondState SQL.==. 0, PPeerUdpEnableTime SQL.<. currentTime] []

  getClosestPeers point limit = liftIO $ withGlobalSQLPool $ \sqldb -> do
    fmap (map SQL.entityVal) $
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

  updateUdpEnableTime peer enableTime = liftIO $ withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerUdpEnableTime SQL.=. enableTime]

  updateIP peer ip = liftIO $ withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerIp SQL.=. Just ip]

  updateTcpEnableTime peer enableTime = liftIO $ withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerEnableTime SQL.=. enableTime]

  updatePeerDisable peer d = liftIO $ withGlobalSQLPool $ \sqldb -> do
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
  updatePeerUdpDisable peer d = liftIO $ withGlobalSQLPool $ \sqldb -> do
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

  updatePeerLastBestBlockHash  p (PeerLastBestBlockHash h) = liftIO $ withGlobalSQLPool $ runSqlPool $
    SQL.updateWhere [PPeerHost SQL.==. pPeerHost p, PPeerPubkey SQL.==. pPeerPubkey p] [PPeerLastBestBlockHash SQL.=. h]

  setPeerPubkey peer point = liftIO $ withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere [PPeerHost SQL.==. pPeerHost peer] [PPeerPubkey SQL.=. Just point]

  storeDisableException peer exception = liftIO $ withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      try $ SQL.updateWhere (thisPeer peer) [PPeerDisableException SQL.=. exception]

  updateLastMessage peer message = liftIO $ withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere (thisPeer peer) [PPeerLastMsg SQL.=. message]

  resetAllPeerTimeouts = liftIO $ withGlobalSQLPool $ \sqldb -> do
    flip runSqlPool sqldb $
      SQL.updateWhere []
                      [
                        PPeerBondState SQL.=. 0,
                        PPeerEnableTime SQL.=. jamshidBirth,
                        PPeerUdpEnableTime SQL.=. jamshidBirth
                      ]
