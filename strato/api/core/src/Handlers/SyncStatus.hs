{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}

module Handlers.SyncStatus
  ( SyncStatus(..),
    API,
    getSyncStatusClient,
    server,
  )
where

import Blockchain.Strato.RedisBlockDB (getBestBlockInfo, getSyncStatus, getWorldBestBlockInfo, runStratoRedisIO)
import Blockchain.Strato.RedisBlockDB.Models (RedisBestBlock (..))
import Control.Monad.IO.Class
import Data.Aeson
import Data.Swagger
import GHC.Generics
import Servant
import Servant.Client

data SyncStatus = SyncStatus
  { isSynced :: Maybe Bool
  , nodeTotalDifficulty :: Maybe Integer
  , worldTotalDifficulty :: Maybe Integer
  } deriving (Eq, Show, Generic)

instance ToJSON SyncStatus where
  toJSON (SyncStatus s n w) = object [
      "isSynced" .= s,
      "nodeTotalDifficulty" .= n,
      "worldTotalDifficulty" .= w
    ]

instance FromJSON SyncStatus where
  parseJSON = withObject "SyncStatus" $ \o ->
    SyncStatus <$> (o .:? "isSynced")
               <*> (o .:? "nodeTotalDifficulty")
               <*> (o .:? "worldTotalDifficulty")

instance ToSchema SyncStatus

type API =
  "sync" :> "status"
    :> Get '[JSON] SyncStatus

getSyncStatusClient :: ClientM SyncStatus
getSyncStatusClient = client (Proxy @API)

server :: MonadIO m => m SyncStatus
server = do
  status <- runStratoRedisIO getSyncStatus
  nodeBestBlock <- runStratoRedisIO getBestBlockInfo
  worldBestBlock <- runStratoRedisIO getWorldBestBlockInfo
  let nodeNumber = bestBlockNumber <$> nodeBestBlock
      worldNumber = bestBlockNumber <$> worldBestBlock
  pure $ SyncStatus status worldNumber nodeNumber
