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

import           Data.Aeson                     hiding (Success)

import qualified Data.Text                      as T
import           Data.Swagger                   hiding (url)
       
import           Control.Monad.Composable.SQL
import           Control.Monad.Change.Modify
import           Control.Monad.Composable.Vault

import qualified Database.Esqueleto.Legacy       as E

import           GHC.Generics
import           GHC.Stack

import           BlockApps.Logging

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.RedisBlockDB         (runStratoRedisIO, getSyncStatusNow)
import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Strato.Strato23.Client   hiding (verifyPassword)
import           Strato.Strato23.API.Types 
import           Strato.Strato23.Monad (VaultWrapperError)
import           Servant
import           Servant.Client

import           UnliftIO
import           SQLM



data MetadataResponse = MetadataResponse
  { nodePubKey            ::  String
  , nodeAddress           ::  String
  , validators            ::  [Address]
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

instance HasSQL m => Accessible [Address] m where 
    access _ = do
        txrs <-  fmap (map E.entityVal) $  sqlQuery . E.select . E.from $ \(a :: E.SqlExpr (E.Entity ValidatorRef)) -> return a
        pure $  (\(ValidatorRef x) -> x ) <$> txrs
instance ToSchema MetadataResponse

getMetaData :: (  MonadIO m
                , MonadLogger m
                , MonadUnliftIO m
                , HasVault m
                , Accessible [Address] m
                , HasSQL m )
                =>   Maybe T.Text  
                ->   m MetadataResponse
getMetaData token = 
  do
  validators <- access (Proxy @[Address])
  isSynced <- checkIsSynced
  mAddressAndKey <- getPubKeyAndAddress token
  case mAddressAndKey of
    Left  _      -> pure $ (MetadataResponse " "  "Error" validators False False) 
    Right addressAndKey -> pure $ (MetadataResponse 
          ((\l -> drop 1 $ take ((length l) -1 )  l )  $ ((\(PublicKey pubkey) ->   show  pubkey ) $ fst addressAndKey )) --probably a better way to pretty print pubkey
          (show $ snd  addressAndKey) 
          validators  
          isSynced 
          True)




blocVaultWrapper :: (MonadIO m, MonadLogger m, HasVault m, HasCallStack) =>
                    ClientM x -> m x
blocVaultWrapper client' = do
  logInfoCS callStack "Querying Vault Wrapper"
  VaultData url mgr <- access Proxy
  resultEither <-
    liftIO $ runClientM client' (mkClientEnv mgr url)
  either (blocError . VaultWrapperError) return resultEither

getPubKeyAndAddress ::  (MonadIO m, MonadLogger m, MonadUnliftIO m, HasVault m) => Maybe T.Text -> m (Either VaultWrapperError (PublicKey, Address))
getPubKeyAndAddress mAccessToken =
  case mAccessToken of
    Nothing -> throwIO $ InvalidArgs $ "Did not find X-USER-UNIQUE-NAME in the header" 
    Just _  -> try $ fmap unaddressAndUnkey .  blocVaultWrapper $ getKey  "nodekey" Nothing

unaddressAndUnkey :: AddressAndKey -> (PublicKey, Address)
unaddressAndUnkey addressAndKey = (Strato.Strato23.API.Types.unPubKey addressAndKey ,Strato.Strato23.API.Types.unAddress addressAndKey) 

checkIsSynced :: (HasSQL m) => m Bool
checkIsSynced = (runStratoRedisIO getSyncStatusNow) >>= \case Nothing -> pure False; Just c ->pure  c; 
