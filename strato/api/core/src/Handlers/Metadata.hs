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
import Blockchain.SyncDB (getSyncStatusNow, getBestSequencedBlockInfo)
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
    pure $ MetadataResponse validators isSynced True (show $ Conf.networkID (networkConfig ethConf)) urlMap

checkIsSynced :: MonadIO m => m Bool
checkIsSynced = fromMaybe False <$> runStratoRedisIO getSyncStatusNow
