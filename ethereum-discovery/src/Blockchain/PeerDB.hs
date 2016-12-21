{-# LANGUAGE FlexibleInstances, OverloadedStrings, ScopedTypeVariables #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.PeerDB where

import Control.Monad.Logger    (runNoLoggingT)
import Data.Bits
import qualified Data.ByteString as B
import Data.Function
import Data.List
import Data.Maybe
import Data.Time.Clock
import qualified Database.Persist.Postgresql as SQL

import Blockchain.Data.Peer
import Blockchain.EthConf
import Blockchain.ExtWord
import Blockchain.UDP

getClosePeers::NodeID->IO [PPeer]
getClosePeers target = do
  currentTime <- getCurrentTime
  sqldb <- runNoLoggingT $ SQL.createPostgresqlPool connStr' 20
  allPeers <- 
    fmap (map SQL.entityVal) $ flip SQL.runSqlPool sqldb $ 
    SQL.selectList [PPeerEnableTime SQL.<. currentTime, PPeerPubkey SQL.!=. Nothing] []

  return $ take 16 $ sortBy (compare `on` (distance target) . pointToNodeID . fromMaybe (error "internal error in getClosePeers") . pPeerPubkey) allPeers

distance::NodeID->NodeID->Word512
distance (NodeID x) (NodeID y) = bytesToWord512 $ zipWith (xor) (B.unpack x) (B.unpack y)

getNumAvailablePeers::IO Int
getNumAvailablePeers = do
  currentTime <- getCurrentTime
  sqldb <- runNoLoggingT $ SQL.createPostgresqlPool connStr' 20
  fmap length $ flip SQL.runSqlPool sqldb $ 
    SQL.selectList [PPeerEnableTime SQL.<. currentTime] []

