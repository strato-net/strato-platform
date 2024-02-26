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
    MetadataResponse,
    server,
    UrlMap,
  )
where

import BlockApps.Logging
import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Options (computeNetworkID)
import Blockchain.Strato.Model.Secp256k1 hiding (HasVault (..))
import Blockchain.Strato.RedisBlockDB (getSyncStatusNow, runStratoRedisIO)
import Control.Lens
import Control.Monad.Change.Modify
import Control.Monad.Composable.SQL
import Control.Monad.Composable.Vault
import Data.Aeson hiding (Success)
import Data.Aeson.Casing.Internal (camelCase, dropFPrefix)
import Data.Map (Map, fromList)
import Data.Maybe (fromJust, fromMaybe)
import Data.Swagger hiding (url)
import qualified Database.Esqueleto.Legacy as E
import GHC.Generics
import GHC.Stack
import qualified LabeledError
import SQLM
import Servant
import Servant.Client
import qualified Strato.Strato23.API.Types as V
import Strato.Strato23.Client hiding (verifyPassword)
import UnliftIO

type UrlMap = Map String String

data MetadataResponse = MetadataResponse
  { nodePubKey :: V.PublicKey,
    nodeAddress :: Address,
    validators :: [ChainMemberParsedSet],
    isSynced :: Bool,
    isVaultPasswordSet :: Bool,
    networkID :: String, -- cuz JSON can't rep integers > 2^53
    urls :: UrlMap
  }
  deriving (Eq, Show, Generic, FromJSON, ToJSON)

type API = "metadata" :> Get '[JSON] MetadataResponse

getMetaDataClient :: ClientM MetadataResponse
getMetaDataClient = client (Proxy @API)

server :: (HasVault m, MonadLogger m, HasSQL m, Accessible UrlMap m) => ServerT API m
server = getMetaData

instance HasSQL m => Accessible [ChainMemberParsedSet] m where
  access _ = do
    txrs <- fmap (map E.entityVal) $ sqlQuery . E.select . E.from $ \(a :: E.SqlExpr (E.Entity ValidatorRef)) -> return a
    pure $ (\(ValidatorRef o u c) -> CommonName o u c True) <$> txrs

instance ToSchema MetadataResponse where
  declareNamedSchema proxy =
    genericDeclareNamedSchema metadataSchemaOptions proxy
      & mapped . schema . description ?~ "MetadataResponse"
      & mapped . schema . example ?~ toJSON exMetadataRespone

exMetadataRespone :: MetadataResponse
exMetadataRespone =
  let pubKey = (fromJust $ importPublicKey $ LabeledError.b16Decode "exMetadataResponse" "04b1145444ab72758420e9dec9dc21b5aab0b84ed5f709677b9e9bfe477b8dffcd8e9a88338769f6d1a958c3063620593d504f6b4e0c56f72a6ca98fae7ce92eb7")
   in MetadataResponse
        pubKey
        (fromPublicKey pubKey)
        [CommonName "BlockApps" "Engineering" "Admin" True]
        True
        True
        "0"
        (fromList [("vault", "http://vault.com")])

-- | The model's field modifiers will match the JSON instances
metadataSchemaOptions :: SchemaOptions
metadataSchemaOptions =
  SchemaOptions
    { fieldLabelModifier = camelCase . dropFPrefix,
      constructorTagModifier = id,
      datatypeNameModifier = id,
      allNullaryToStringTag = True,
      unwrapUnaryRecords = True
    }

getMetaData ::
  ( MonadLogger m,
    HasVault m,
    Accessible [ChainMemberParsedSet] m,
    Accessible UrlMap m,
    HasSQL m
  ) =>
  m MetadataResponse
getMetaData =
  do
    validators <- access (Proxy @[ChainMemberParsedSet])
    isSynced <- checkIsSynced
    V.AddressAndKey a k <- getPubKeyAndAddress
    urlMap <- access (Proxy @UrlMap)
    pure $ MetadataResponse k a validators isSynced True (show computeNetworkID) urlMap

blocVaultWrapper ::
  (MonadIO m, MonadLogger m, HasVault m, HasCallStack) =>
  ClientM x ->
  m x
blocVaultWrapper client' = do
  logInfoCS callStack "Querying Vault Wrapper"
  VaultData url mgr <- access Proxy
  resultEither <-
    liftIO $ runClientM client' (mkClientEnv mgr url)
  either (blocError . VaultWrapperError) return resultEither

getPubKeyAndAddress :: (MonadLogger m, MonadUnliftIO m, HasVault m) => m V.AddressAndKey
getPubKeyAndAddress = blocVaultWrapper $ getKey Nothing Nothing

checkIsSynced :: (HasSQL m) => m Bool
checkIsSynced = fromMaybe False <$> runStratoRedisIO getSyncStatusNow
