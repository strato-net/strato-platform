{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Discovery.PeerDB where

import           Control.Monad.IO.Class
import           Control.Monad.Trans.Control
import           Data.Bits
import qualified Data.ByteString                       as B
import           Data.Function
import           Data.List
import           Data.Maybe
import           Data.Time.Clock
import qualified Database.Persist.Postgresql           as SQL

import           Blockchain.DB.SQLDB                   (withGlobalSQLPool)
import           Blockchain.ExtWord

import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.UDP

getClosePeers :: (MonadBaseControl IO m, MonadIO m) => NodeID -> m [PPeer]
getClosePeers target = do
  currentTime <- liftIO getCurrentTime
  allPeers <- withGlobalSQLPool $ \sqldb ->
    fmap (map SQL.entityVal) $ flip SQL.runSqlPool sqldb $
    SQL.selectList [PPeerEnableTime SQL.<. currentTime, PPeerPubkey SQL.!=. Nothing] []
  return $ take 16 $ sortBy (compare `on` (distance target) . pointToNodeID . fromMaybe (error "internal error in getClosePeers") . pPeerPubkey) allPeers

distance :: NodeID -> NodeID -> Word512
distance (NodeID x) (NodeID y) = bytesToWord512 $ zipWith (xor) (B.unpack x) (B.unpack y)

getNumAvailablePeers :: (MonadBaseControl IO m, MonadIO m) => m Int
getNumAvailablePeers = do
    currentTime <- liftIO getCurrentTime
    withGlobalSQLPool $ \sqldb -> fmap length $ flip SQL.runSqlPool sqldb $
        SQL.selectList [PPeerEnableTime SQL.<. currentTime] []

