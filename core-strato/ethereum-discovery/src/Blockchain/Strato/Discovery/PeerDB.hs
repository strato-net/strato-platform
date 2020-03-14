{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Discovery.PeerDB (
  getNumAvailablePeers,
  getPeersClosestTo
  ) where

import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Crypto.Types.PubKey.ECC
import qualified Data.Text as T
import           Data.Time.Clock
import qualified Database.Persist.Postgresql           as SQL

import           Blockchain.DB.SQLDB                   (runSqlPool, withGlobalSQLPool)
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.UDP

getNumAvailablePeers :: MonadUnliftIO m => m Int
getNumAvailablePeers = do
    currentTime <- liftIO getCurrentTime
    withGlobalSQLPool $ fmap length . runSqlPool -- lolololol ever heard of SELECT COUNT
                      (SQL.selectList [PPeerEnableTime SQL.<. currentTime] [])

-- todo: respect the requester's target. also is this basically getClosePeers?s
getPeersClosestTo :: MonadUnliftIO m => NodeID -> T.Text -> Point -> m [PPeer]
getPeersClosestTo _ requesterIP _ = do
    peerEnts <- withGlobalSQLPool . runSqlPool $
        SQL.selectList [ PPeerIp SQL.!=. requesterIP, PPeerPubkey SQL.!=. Nothing] []
    let rets = (\(SQL.Entity _ ent) -> ent) <$> peerEnts
    return $ take 20 rets
