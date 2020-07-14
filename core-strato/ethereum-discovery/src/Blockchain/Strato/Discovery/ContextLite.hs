{-# LANGUAGE FlexibleContexts               #-}
{-# LANGUAGE FlexibleInstances              #-}
{-# LANGUAGE GADTs                          #-}
{-# LANGUAGE MultiParamTypeClasses          #-}
{-# LANGUAGE TypeApplications               #-}
{-# LANGUAGE TypeOperators                  #-}
{-# LANGUAGE TypeSynonymInstances           #-}
{-# LANGUAGE UndecidableInstances           #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
module Blockchain.Strato.Discovery.ContextLite
  ( ContextLite -- (..)
  , initContextLite
  , addPeer
  ) where


import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.ECDSA
import           Blockchain.Strato.Discovery.Data.Peer
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

instance (Monad m, MonadIO m) => HasVault (ReaderT ContextLite m) where
  sign msg = do
    vc <- asks vaultClient
    liftIO $ waitOnVault $ runClientM (VC.postSignature (T.pack "nodekey") (VC.MsgHash msg)) vc

  getPub = error "called HasVault's getPub in ethereum-discovery, but this should never happen"
  getShared _ = error "called HasVault's getShared in ethereum-discovery, but this should never happen"

-- TODO: this should be in a vc util module since we use it in multiple places now
waitOnVault :: IO (Either a b) -> IO b
waitOnVault action = do
  res <- action
  case res of 
    Left _ -> do
      threadDelay $ 2000000 -- 2 seconds
      waitOnVault action
    Right val -> return val

initContextLite :: MonadUnliftIO m => m ContextLite
initContextLite = do
  dbs <- openDBs
  mgr <- liftIO $ newManager defaultManagerSettings
  url <- liftIO $ parseBaseUrl "http://vault-wrapper:8000/strato/v2.3" -- someday this may need to be a cl arg
  return ContextLite { liteSQLDB = sqlDB' dbs
                     , vaultClient = ClientEnv mgr url Nothing
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
