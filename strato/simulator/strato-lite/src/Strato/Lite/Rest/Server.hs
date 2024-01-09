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

module Strato.Lite.Rest.Server where

import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.Sequencer.Event
import Blockchain.Strato.Discovery.Data.MemPeerDB
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.MicroTime
import qualified Control.Concurrent.STM.MonadIO as CCS
import Control.Lens
import Control.Monad.IO.Class
import Control.Monad.Reader
import Data.Bifunctor (first)
import Data.Foldable (for_, traverse_)
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import Data.Traversable (for)
import Servant
import Strato.Lite.Monad
import Strato.Lite.Rest.Api
import UnliftIO hiding (Handler)

getNodes :: NetworkManager -> Handler ThreadResultMap
getNodes mgr = liftIO . atomically $ do
  ths <- readTVar $ mgr ^. threads
  for (ths ^. nodeThreads) $ \a -> do
    mExp <- pollSTM a
    pure $ fmap (first show) mExp

getConnections :: NetworkManager -> Handler ThreadResultMap
getConnections mgr = liftIO . atomically $ do
  ths <- readTVar $ mgr ^. threads
  let f (s, c) = "(" <> s <> "," <> c <> ")"
  fmap (M.mapKeys f) . for (ths ^. connectionThreads) $ \a -> do
    mExp <- pollSTM a
    pure $ fmap (first show) mExp

getChainInfo :: NetworkManager -> T.Text -> Handler ThreadResultMap
getChainInfo mgr nodeLabel = liftIO . atomically $ do
  ths <- readTVar $ mgr ^. network
  let theNode = fromMaybe (error "Node not found.") $ M.lookup nodeLabel $ ths ^. nodes
  ctxt <- (CCS.readTVarSTM . _p2pTestContext) theNode
  let chainInfo = (Just . Left) $ show $ ctxt ^. chainInfoMap
      res = M.singleton nodeLabel chainInfo
  pure $ res

getPeers :: NetworkManager -> T.Text -> Handler [T.Text]
getPeers mgr label = do
  mPeer <- liftIO $ fmap (M.lookup label . _nodes) . readTVarIO $ mgr ^. network
  case mPeer of
    Nothing -> return []
    Just peer -> do
      peerMap <- liftIO $ readIORef. stringPPeerMap . _p2pPeerDB $ peer
      let peers = map T.pack . M.keys $ peerMap
      pure peers

postAddNode :: NetworkManager -> T.Text -> AddNodeParams -> Handler Bool
postAddNode mgr label (AddNodeParams ip identity bootNodes) =
  liftIO $ runReaderT (addNode label identity (IPAsText ip) (TCPPort 30303) (UDPPort 30303) (IPAsText <$> bootNodes)) mgr

postRemoveNode :: NetworkManager -> T.Text -> Handler Bool
postRemoveNode mgr label = liftIO $ runReaderT (removeNode label) mgr

postAddConnection :: NetworkManager -> T.Text -> T.Text -> Handler Bool
postAddConnection mgr s c = liftIO $ runReaderT (addConnection s c) mgr

postRemoveConnection :: NetworkManager -> T.Text -> T.Text -> Handler Bool
postRemoveConnection mgr s c = liftIO $ runReaderT (removeConnection s c) mgr

postTimeout :: NetworkManager -> Int -> Handler ()
postTimeout mgr rn = do
  let ev = TimerFire $ fromIntegral rn
  peers <- liftIO $ fmap (M.elems . _nodes) . readTVarIO $ mgr ^. network
  liftIO $ traverse_ (postEvent ev) peers

postTx :: NetworkManager -> T.Text -> PostTxParams -> Handler ()
postTx mgr nodeLabel (PostTxParams tx md) = do
  mPeer <- liftIO $ fmap (M.lookup nodeLabel . _nodes) . readTVarIO $ mgr ^. network
  liftIO . for_ mPeer $ \peer -> do
    ts <- liftIO $ getCurrentMicrotime
    let signedTx = mkSignedTx (peer ^. p2pPeerPrivKey) tx md
        ev = UnseqEvent . IETx ts $ IngestTx Origin.API signedTx
    postEvent ev peer

stratoLiteRestServer :: NetworkManager -> Server StratoLiteRestAPI
stratoLiteRestServer mgr =
  getNodes mgr
    :<|> getConnections mgr
    :<|> getChainInfo mgr
    :<|> getPeers mgr
    :<|> postAddNode mgr
    :<|> postRemoveNode mgr
    :<|> postAddConnection mgr
    :<|> postRemoveConnection mgr
    :<|> postTimeout mgr
    :<|> postTx mgr

stratoLiteRestApp :: NetworkManager -> Application
stratoLiteRestApp = serve stratoLiteRestAPI . stratoLiteRestServer
