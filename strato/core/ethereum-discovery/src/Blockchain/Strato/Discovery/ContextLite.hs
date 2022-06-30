{-# LANGUAGE FlexibleContexts               #-}
{-# LANGUAGE FlexibleInstances              #-}
{-# LANGUAGE GADTs                          #-}
{-# LANGUAGE MultiParamTypeClasses          #-}
{-# LANGUAGE TypeApplications               #-}
{-# LANGUAGE TypeOperators                  #-}
{-# LANGUAGE TypeSynonymInstances           #-}
{-# LANGUAGE UndecidableInstances           #-}
{-# LANGUAGE TemplateHaskell                #-}
{-# LANGUAGE OverloadedStrings              #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}

module Blockchain.Strato.Discovery.ContextLite
  ( ContextLite -- (..)
  , initContextLite
  , addPeer
  ) where


import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           BlockApps.Logging
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.Secp256k1
import           Control.Concurrent                    (threadDelay)
import           Control.Monad.Change.Modify           (Accessible(..))
import           Control.Monad.IO.Class
import           Control.Monad.Reader
import           Control.Monad.IO.Unlift
import qualified Data.Text                             as T
import qualified Database.Persist.Postgresql           as SQL

import           Network.HTTP.Client                   (newManager, defaultManagerSettings)
import           Servant.Client
import qualified Strato.Strato23.API                   as VC
import qualified Strato.Strato23.Client                as VC

data ContextLite =
  ContextLite { liteSQLDB :: SQLDB
              , vaultClient :: ClientEnv
              }

instance Monad m => Accessible SQLDB (ReaderT ContextLite m) where
  access _ = asks liteSQLDB

instance (Monad m, MonadIO m, MonadLogger m) => HasVault (ReaderT ContextLite m) where
  sign msg = do
    vc <- asks vaultClient
    $logInfoS "HasVault" "asking vault-wrapper for a message signature"
    waitOnVault $ liftIO $ runClientM (VC.postSignature (T.pack "nodekey") (VC.MsgHash msg)) vc

  getPub = do
    vc <- asks vaultClient
    $logInfoS "HasVault" "asking vault-wrapper for the node's public key"
    fmap VC.unPubKey $ waitOnVault $ liftIO $ runClientM (VC.getKey (T.pack "nodekey") Nothing) vc

  getShared _ = error "called HasVault's getShared in ethereum-discovery, but this should never happen"

waitOnVault :: (MonadIO m, MonadLogger m, Show a) => m (Either a b) -> m b
waitOnVault action = do
  res <- action
  case res of 
    Left err -> do
      $logErrorS "HasVault" . T.pack $ "vault-wrapper returned an error: " ++ show err 
      liftIO $ threadDelay $ 2000000 -- 2 seconds
      waitOnVault action
    Right val -> return val

initContextLite :: MonadUnliftIO m => String -> m ContextLite
initContextLite vaultUrl = do
  dbs <- openDBs
  mgr <- liftIO $ newManager defaultManagerSettings
  url <- liftIO $ parseBaseUrl vaultUrl
  return ContextLite { liteSQLDB = sqlDB' dbs
                     , vaultClient = mkClientEnv mgr url
                     }

addPeer :: HasSQLDB m =>PPeer->m (SQL.Key PPeer)
addPeer peer = do
  maybePeer <- getPeerByIP (T.unpack $ pPeerIp peer)
  sqlQuery $ actions maybePeer
  where actions mp = case mp of
            Nothing -> SQL.insert peer
            Just peer'-> do
              SQL.update (SQL.entityKey peer') [ PPeerPubkey SQL.=. pPeerPubkey peer
                                               , PPeerEnode SQL.=. pPeerEnode peer
                                               ]
              return (SQL.entityKey peer')

getPeerByIP :: HasSQLDB m =>String->m (Maybe (SQL.Entity PPeer))
getPeerByIP ip = do
  entPeer <- sqlQuery actions

  case entPeer of
    []  -> return Nothing
    lst -> return $ Just . head $ lst

  where actions = SQL.selectList [ PPeerIp SQL.==. T.pack ip ] []
