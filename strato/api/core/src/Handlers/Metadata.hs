{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Handlers.Metadata
  ( API,
    getMetaDataClient,
    MetadataResponse(..),
    server,
    UrlMap,
  )
where

import BlockApps.Logging
import Blockchain.Model.SyncState
import Blockchain.EthConf (ethConf, networkConfig)
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Strato.Model.Validator
import Blockchain.Strato.RedisBlockDB (runStratoRedisIO)
import Blockchain.SyncDB (getSyncStatusNow, getBestSequencedBlockInfo, getBestBlockInfo, getCirrusBestBlockNumber)
import Control.Lens
import Control.Monad.Change.Modify
import Control.Monad.Reader
import Data.Aeson hiding (Success)
import Data.Aeson.Casing.Internal (camelCase, dropFPrefix)
import Data.Map (Map, fromList)
import Data.Maybe (fromMaybe)
import Data.OpenApi hiding (url, server)
import GHC.Generics
import Servant
import Servant.Client
import UnliftIO

type UrlMap = Map String String

data MetadataResponse = MetadataResponse
  { validators :: [Validator],
    isSynced :: Bool,
    isVaultPasswordSet :: Bool,
    networkID :: String, -- cuz JSON can't rep integers > 2^53
    chainId :: String,
    networkName :: String,
    urls :: UrlMap
  }
  deriving (Eq, Show, Generic, FromJSON, ToJSON)

type API = "metadata" :> Get '[JSON] MetadataResponse

getMetaDataClient :: ClientM MetadataResponse
getMetaDataClient = client (Proxy @API)

server
  :: ( MonadUnliftIO m
     , MonadLogger m
     , Accessible UrlMap m
     )
  => ServerT API m
server = getMetaData

instance ToSchema MetadataResponse where
  declareNamedSchema proxy =
    genericDeclareNamedSchema metadataSchemaOptions proxy
      & mapped . schema . description ?~ "MetadataResponse"
      & mapped . schema . example ?~ toJSON exMetadataRespone

exMetadataRespone :: MetadataResponse
exMetadataRespone =
  MetadataResponse
    [Validator 0xdeadbeef]
    True
    True
    "0"
    "0"
    "helium"
    (fromList [("vault", "http://vault.com")])

-- | The model's field modifiers will match the JSON instances
metadataSchemaOptions :: SchemaOptions
metadataSchemaOptions =
  defaultSchemaOptions
    { Data.OpenApi.fieldLabelModifier = camelCase . dropFPrefix
    }

getMetaData ::
  ( MonadLogger m,
    MonadUnliftIO m,
    Accessible UrlMap m
  ) =>
  m MetadataResponse
getMetaData =
  do
    validators <- fromMaybe [] . fmap bestSequencedBlockValidators <$> runStratoRedisIO getBestSequencedBlockInfo
    isSynced <- checkIsSynced
    urlMap <- access (Proxy @UrlMap)
    let nc = networkConfig ethConf
    pure $ MetadataResponse validators isSynced True (show $ Conf.networkID nc) (show $ Conf.chainId nc) (Conf.network nc) urlMap

-- | A node counts as synced only when the p2p/VM pipeline has caught up to
-- the network (the Redis sync status) AND Cirrus has been indexed up to the
-- node's best block. Cirrus is fed by slipstream from a separate Kafka topic
-- (vmevents) and can lag tens of thousands of blocks behind at the moment the
-- p2p pipeline catches up, so the base status alone overstates readiness.
-- The Cirrus part is true when slipstream's high-water mark has reached the
-- node's best block, allowing one block of transient lag (mirroring the
-- ntd + 1 hysteresis in checkAndUpdateSyncStatus). A missing high-water mark
-- counts as not synced: slipstream writes one as soon as it processes its
-- first vmevents batch, and even the genesis block produces a NewAction, so on
-- a node with sqlDiff enabled the mark is only ever absent while Cirrus
-- indexing is behind (or slipstream is down, which equally should not report
-- synced).
checkIsSynced :: MonadIO m => m Bool
checkIsSynced = runStratoRedisIO $ do
  baseSynced <- fromMaybe False <$> getSyncStatusNow
  let cirrusEnabled = Conf.sqlDiff . Conf.vmConfig $ ethConf
  if not (baseSynced && cirrusEnabled)
    then pure baseSynced
    else do
      nodeBest <- getBestBlockInfo
      cirrusBest <- getCirrusBestBlockNumber
      pure $ case (nodeBest, cirrusBest) of
        (Just bb, Just cirrusBlockNumber) -> cirrusBlockNumber + 1 >= bestBlockNumber bb
        (Nothing, _) -> True -- no node tip to compare against; defer to the base status
        (Just _, Nothing) -> False
