{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Lite.Rest.Server where

import Bloc.API
import Bloc.Monad
import Bloc.Server
import BlockApps.Logging
import Blockchain.Blockstanbul
import Blockchain.DB.SQLDB
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Monad
import Blockchain.Strato.Discovery.Data.MemPeerDB
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Host
import Control.Lens
import Control.Monad.IO.Class
import Control.Monad.Reader
import Control.Monad.Trans.Except
import Control.Monad.Trans.Resource
import Core.API
import Data.Aeson (Value)
import Data.Bifunctor (first)
import Data.Foldable (traverse_)
import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes, listToMaybe)
import qualified Data.Text as T
import SQLM
import Servant
import Servant.Client
import Strato.Lite.Base.Filesystem
import Strato.Lite.Base.Simulator
import Strato.Lite.Cirrus
import Strato.Lite.Core
import Strato.Lite.Simulator hiding (client)
import Strato.Lite.Rest.Api
import UnliftIO hiding (Handler)

getNodes :: NetworkManager -> Handler NodeResultMap
getNodes mgr = liftIO . atomically $ do
  ths <- readTVar $ mgr ^. threads
  net <- readTVar $ mgr ^. network
  flip M.traverseWithKey (ths ^. nodeThreads) $ \n a -> do
    mExp <- listToMaybe . catMaybes <$> traverse (fmap (fmap (first show)) . pollSTM) a
    case net ^. nodes . at n of
      Nothing -> pure $ NodeStatus "0.0.0.0" 0 0 False mExp
      Just (s,c) -> do
        let coreCtx = c ^. corePeerContext
        mBCtx <- _blockstanbulContext <$> readTVar (coreCtx ^. sequencerContext)
        let mView = _view <$> mBCtx
            rNum = maybe 0 (fromIntegral . _round) mView
            sNum = maybe 0 (fromIntegral . _sequence) mView
            isVal = maybe False _isValidator mBCtx
            Host ip = s ^. simulatorPeerIPAddress
        pure $ NodeStatus ip rNum sNum isVal mExp

getPeers :: NetworkManager -> T.Text -> Handler [T.Text]
getPeers mgr label = do
  mPeer <- liftIO $ fmap (M.lookup label . _nodes) . readTVarIO $ mgr ^. network
  case mPeer of
    Nothing -> return []
    Just (peer,_) -> do
      simCtx <- liftIO . atomically . readTVar $ peer ^. simulatorPeerContext
      peerMap <- liftIO . readIORef . stringPPeerMap $ simCtx ^. simulatorContextPeerMap
      let peers = map (\(Host h) -> h) . M.keys $ peerMap
      pure peers

postAddNode :: NetworkManager -> T.Text -> AddNodeParams -> Handler Bool
postAddNode mgr label (AddNodeParams ip _ bootNodes) =
  liftIO . runLoggingT . runResourceT $ runReaderT (addSimulatorNode "strato-lite" label (Host ip) (TCPPort 30303) (UDPPort 30303) (Host <$> bootNodes)) mgr

postRemoveNode :: NetworkManager -> T.Text -> Handler Bool
postRemoveNode mgr label = liftIO . runLoggingT . runResourceT $ runReaderT (removeSimulatorNode label) mgr

postTimeout :: NetworkManager -> Int -> Handler ()
postTimeout mgr rn = do
  let ev = TimerFire $ fromIntegral rn
  peers <- liftIO $ fmap (M.elems . _nodes) . readTVarIO $ mgr ^. network
  liftIO $ traverse_ (postEvent ev . snd) peers

stratoLiteRestServer :: NetworkManager -> Server StratoLiteRestAPI
stratoLiteRestServer mgr =
  getNodes mgr
    :<|> getPeers mgr
    :<|> postAddNode mgr
    :<|> postRemoveNode mgr
    :<|> postTimeout mgr

type CirrusAPI = "cirrus" :> "search" :> Capture "contractName" T.Text :> Get '[JSON] Value

type CombinedAPI = "strato-api" :> CoreAPI :<|> "bloc" :> "v2.2" :> BlocAPI
type NodeAPI = "nodes" :> Capture "nodeLabel" T.Text :> CombinedAPI

type FullAPI = StratoLiteRestAPI :<|> NodeAPI

fullAPI :: Proxy FullAPI
fullAPI = Proxy

multinodeServer :: NetworkManager -> BlocEnv -> UrlMap -> T.Text -> Server CombinedAPI
multinodeServer mgr blocEnv urlMap nodeLabel = hoistServer (Proxy :: Proxy CombinedAPI) (convertErrors runM) (coreApiServer :<|> bloc)
  where
    convertErrors r x = Handler $ do
      mNode <- liftIO $ M.lookup nodeLabel . _nodes <$> readTVarIO (mgr ^. network)
      case mNode of
        Nothing -> throwE . apiErrorToServantErr . UserError $ "Node " <> nodeLabel <> " not found"
        Just p -> do
          y <- liftIO . try . r p $ x `catch` handleRuntimeError `catch` handleApiError
          case y of
            Right a -> pure a
            Left e -> throwE $ apiErrorToServantErr e
    runM (s,c) f = do
      simCtx <- liftIO . atomically . readTVar $ s ^. simulatorPeerContext
      runLoggingT
        . runResourceT
        . flip runReaderT blocEnv
        . flip runReaderT urlMap
        . runMemPeerDBMUsingEnv (simCtx ^. simulatorContextPeerMap)
        . flip runReaderT s
        . flip runReaderT c
        $ f

cirrusClient :: Client ClientM CirrusAPI
cirrusClient = client (Proxy @CirrusAPI)

cirrusHandler :: MonadIO m => FilesystemPeer -> T.Text -> m Value
cirrusHandler fPeer tableName = liftIO $ queryCirrus (fPeer ^. filesystemDBs . cirrusSqlPool) tableName

singleNodeRestServer :: FilesystemPeer -> CorePeer -> BlocEnv -> UrlMap -> Server (CombinedAPI :<|> CirrusAPI)
singleNodeRestServer fPeer cPeer blocEnv urlMap = hoistServer (Proxy :: Proxy (CombinedAPI :<|> CirrusAPI)) (convertErrors runM) ((coreApiServer :<|> bloc) :<|> cirrusHandler fPeer)
  where
    convertErrors r x = Handler $ do
          y <- liftIO . try . r $ x `catch` handleRuntimeError `catch` handleApiError
          case y of
            Right a -> pure a
            Left e -> throwE $ apiErrorToServantErr e
    runM f = do
      runLoggingT
        . runResourceT
        . flip runReaderT blocEnv
        . flip runReaderT urlMap
        . runMemPeerDBMUsingEnv (fPeer ^. filesystemPeerMap)
        . flip runReaderT (SQLDB . _ethSqlPool $ _filesystemDBs fPeer)
        . flip runReaderT fPeer
        . flip runReaderT cPeer
        $ f

combinedSimulatorRestServer :: NetworkManager -> BlocEnv -> UrlMap -> Server FullAPI
combinedSimulatorRestServer mgr blocEnv urlMap = (stratoLiteRestServer mgr) :<|> (multinodeServer mgr blocEnv urlMap)

stratoLiteSimulatorRestApp :: NetworkManager -> BlocEnv -> UrlMap -> Application
stratoLiteSimulatorRestApp mgr blocEnv = serve fullAPI . combinedSimulatorRestServer mgr blocEnv