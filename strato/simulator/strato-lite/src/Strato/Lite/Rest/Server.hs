{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Lite.Rest.Server where

import Bloc.API
import Bloc.Monad
import Bloc.Server
import BlockApps.Logging
import Blockchain.Blockstanbul
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.Model.WrappedBlock
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Monad
import Blockchain.Strato.Discovery.Data.MemPeerDB
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.MicroTime
import Blockchain.Strato.Model.Validator
import Control.Lens
import Control.Monad.IO.Class
import Control.Monad.Reader
import Control.Monad.Trans.Except
import Control.Monad.Trans.Resource
import Core.API
import Data.Bifunctor (first)
import Data.Foldable (for_, traverse_)
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import SQLM
import Servant
import Strato.Lite.Base.Simulator
import Strato.Lite.Core
import Strato.Lite.Simulator
import Strato.Lite.Rest.Api
import UnliftIO hiding (Handler)

getNodes :: NetworkManager -> Handler NodeResultMap
getNodes mgr = liftIO . atomically $ do
  ths <- readTVar $ mgr ^. threads
  net <- readTVar $ mgr ^. network
  flip M.traverseWithKey (ths ^. nodeThreads) $ \n a -> do
    mExp <- fmap (first show) <$> pollSTM a
    case net ^. nodes . at n of
      Nothing -> pure $ NodeStatus "0.0.0.0" 0 0 False mExp
      Just (s,c) -> do
        coreCtx <- readTVar $ c ^. corePeerContext
        let mBCtx = coreCtx ^. sequencerContext . blockstanbulContext
            mView = _view <$> mBCtx
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
postAddNode mgr label (AddNodeParams ip identity bootNodes) =
  liftIO $ runReaderT (addSimulatorNode "strato-lite" label (Validator identity) (Host ip) (TCPPort 30303) (UDPPort 30303) (Host <$> bootNodes)) mgr

postRemoveNode :: NetworkManager -> T.Text -> Handler Bool
postRemoveNode mgr label = liftIO $ runReaderT (removeSimulatorNode label) mgr

postTimeout :: NetworkManager -> Int -> Handler ()
postTimeout mgr rn = do
  let ev = TimerFire $ fromIntegral rn
  peers <- liftIO $ fmap (M.elems . _nodes) . readTVarIO $ mgr ^. network
  liftIO $ traverse_ (postEvent ev . snd) peers

postTx :: NetworkManager -> T.Text -> PostTxParams -> Handler ()
postTx mgr nodeLabel (PostTxParams tx md) = do
  mPeer <- liftIO $ fmap (M.lookup nodeLabel . _nodes) . readTVarIO $ mgr ^. network
  liftIO . for_ mPeer $ \(s,c) -> do
    ts <- liftIO $ getCurrentMicrotime
    let signedTx = mkSignedTx (s ^. simulatorPeerPrivKey) tx md
        ev = UnseqEvents [IETx ts $ IngestTx Origin.API signedTx]
    postEvent ev c

stratoLiteRestServer :: NetworkManager -> Server StratoLiteRestAPI
stratoLiteRestServer mgr =
  getNodes mgr
    :<|> getPeers mgr
    :<|> postAddNode mgr
    :<|> postRemoveNode mgr
    :<|> postTimeout mgr
    :<|> postTx mgr

type CombinedAPI = "strato-api" :> CoreAPI :<|> "bloc" :> "v2.2" :> BlocAPI
type NodeAPI = "nodes" :> Capture "nodeLabel" T.Text :> CombinedAPI

type FullAPI = StratoLiteRestAPI :<|> NodeAPI

fullAPI :: Proxy FullAPI
fullAPI = Proxy

nodeServer :: NetworkManager -> BlocEnv -> UrlMap -> T.Text -> Server CombinedAPI
nodeServer mgr blocEnv urlMap nodeLabel = hoistServer (Proxy :: Proxy CombinedAPI) (convertErrors runM) (coreApiServer :<|> bloc)
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

combinedRestServer :: NetworkManager -> BlocEnv -> UrlMap -> Server FullAPI
combinedRestServer mgr blocEnv urlMap = (stratoLiteRestServer mgr) :<|> (nodeServer mgr blocEnv urlMap)

stratoLiteRestApp :: NetworkManager -> BlocEnv -> UrlMap -> Application
stratoLiteRestApp mgr blocEnv = serve fullAPI . combinedRestServer mgr blocEnv