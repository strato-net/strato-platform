{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE LambdaCase                 #-}

module Handlers.Metadata
  (  API
    , getMetaDataClient
    , MetadataResponse
    , server
  ) where

import           Control.Lens
import           Data.Aeson                     hiding (Success)

import qualified Data.Text                      as T
import           Data.Aeson.Casing.Internal     (camelCase, dropFPrefix)
import           Data.Maybe                     (fromJust)
import           Data.Swagger                   hiding (url)
       
import           Control.Monad.Composable.SQL
import           Control.Monad.Change.Modify
import           Control.Monad.Composable.Vault

import qualified Database.Esqueleto.Legacy       as E

import           GHC.Generics
import           GHC.Stack

import           BlockApps.Logging

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainMember
import           Blockchain.Strato.Model.Secp256k1      hiding (HasVault(..))
import           Blockchain.Strato.RedisBlockDB         (runStratoRedisIO, getSyncStatus)
import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Strato.Strato23.Client   hiding (verifyPassword)
import qualified Strato.Strato23.API.Types as V
import           Servant
import           Servant.Client

import qualified LabeledError
import           UnliftIO
import           SQLM

data MetadataResponse = MetadataResponse
  { nodePubKey            ::  V.PublicKey
  , nodeAddress           ::  Address
  , validators            ::  [ChainMemberParsedSet]
  , isSynced              ::  Bool
  , isVaultPasswordSet    ::  Bool
  } deriving (Eq, Show, Generic, FromJSON, ToJSON)

type API = "metadata"
  :> Servant.Header "X-USER-UNIQUE-NAME" T.Text
  :> Get '[JSON] MetadataResponse

getMetaDataClient :: Maybe T.Text -> ClientM MetadataResponse
getMetaDataClient = client (Proxy @API)

server :: (HasVault m, MonadLogger m, HasSQL m) => ServerT API m
server = getMetaData

instance HasSQL m => Accessible [ChainMemberParsedSet] m where 
  access _ = do
    txrs <-  fmap (map E.entityVal) $  sqlQuery . E.select . E.from $ \(a :: E.SqlExpr (E.Entity ValidatorRef)) -> return a
    pure $  (\(ValidatorRef o u c) -> CommonName o u c True) <$> txrs

instance ToSchema MetadataResponse where
  declareNamedSchema proxy = genericDeclareNamedSchema metadataSchemaOptions proxy
    & mapped.schema.description ?~ "MetadataResponse"
    & mapped.schema.example ?~ toJSON exMetadataRespone

exMetadataRespone :: MetadataResponse
exMetadataRespone =
  let pubKey = (fromJust $ importPublicKey $ LabeledError.b16Decode "exMetadataResponse" "04b1145444ab72758420e9dec9dc21b5aab0b84ed5f709677b9e9bfe477b8dffcd8e9a88338769f6d1a958c3063620593d504f6b4e0c56f72a6ca98fae7ce92eb7")
   in MetadataResponse
        pubKey
        (fromPublicKey pubKey)
        [CommonName "BlockApps" "Engineering" "Admin" True]
        True
        True

-- | The model's field modifiers will match the JSON instances
metadataSchemaOptions :: SchemaOptions
metadataSchemaOptions = SchemaOptions
  { fieldLabelModifier = camelCase . dropFPrefix
  , constructorTagModifier = id
  , datatypeNameModifier = id
  , allNullaryToStringTag = True
  , unwrapUnaryRecords = True
  }

getMetaData :: (  MonadIO m
                , MonadLogger m
                , HasVault m
                , Accessible [ChainMemberParsedSet] m
                , HasSQL m )
                =>   Maybe T.Text  
                ->   m MetadataResponse
getMetaData token = 
  do
  validators <- access (Proxy @[ChainMemberParsedSet])
  isSynced <- checkIsSynced
  V.AddressAndKey a k <- getPubKey token
  pure $ MetadataResponse k a validators isSynced True

blocVaultWrapper :: (MonadIO m, MonadLogger m, HasVault m, HasCallStack) =>
                    ClientM x -> m x
blocVaultWrapper client' = do
  logInfoCS callStack "Querying Vault Wrapper"
  VaultData url mgr <- access Proxy
  resultEither <-
    liftIO $ runClientM client' (mkClientEnv mgr url)
  either (blocError . VaultWrapperError) return resultEither

getPubKey ::  (MonadLogger m, MonadUnliftIO m, HasVault m) => Maybe T.Text -> m V.AddressAndKey
getPubKey mAccessToken =
  case mAccessToken of
    Nothing -> throwIO $ InvalidArgs $ "Did not find X-USER-UNIQUE-NAME in the header" -- This may not be needed
    Just _  -> blocVaultWrapper $ getKey  "nodekey" Nothing

checkIsSynced :: (HasSQL m) => m Bool
checkIsSynced = (runStratoRedisIO getSyncStatus) >>= \case Nothing -> pure False; Just c ->pure  c; 