{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE UndecidableInstances #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Discovery.Data.MemPeerDB where

import Blockchain.Strato.Discovery.Data.Host
import Blockchain.Strato.Discovery.Data.Peer
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.Reader
import Control.Lens hiding (Context, view)
import Data.Map (Map)
import qualified Data.Map as M
import qualified Data.Text as T
import Data.Time.Clock (getCurrentTime)
import UnliftIO

data MemPeerDBEnv = MemPeerDBEnv {
  p2pMyIPAddress :: Host,
  stringPPeerMap :: IORef (Map Host PPeer)
}

type MemPeerDBM = ReaderT MemPeerDBEnv

type HasMemPeerDB m = (MonadIO m, AccessibleEnv MemPeerDBEnv m)

createMemPeerDBEnv :: MonadIO m =>
                      Host -> [PPeer] -> m MemPeerDBEnv
createMemPeerDBEnv me peers = do
  peerMap <- newIORef $ M.fromList $ map (\p -> (pPeerHost p, p)) peers

  return $ MemPeerDBEnv me peerMap
                                 
runMemPeerDBMUsingEnv :: MemPeerDBEnv -> MemPeerDBM m a -> m a
runMemPeerDBMUsingEnv env f =
  runReaderT f env
    
runMemPeerDBM :: MonadIO m => Host -> [PPeer] -> MemPeerDBM m a -> m a
runMemPeerDBM me peers f = flip runMemPeerDBMUsingEnv f =<< createMemPeerDBEnv me peers

instance HasMemPeerDB m => Mod.Accessible AvailablePeers m where
  access _ = do
    currentTime <- liftIO getCurrentTime
    host <- accessEnvVar p2pMyIPAddress
    peerMap <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ AvailablePeers $ filter ((< currentTime) . pPeerUdpEnableTime) $ filter ((/= host) . pPeerHost) $ M.elems peerMap

instance A.Replaceable (Host, TCPPort) ActivityState m where
  replace = error "'A.Replaceable (Host, TCPPort) ActivityState m' not implemented"

instance HasMemPeerDB m => A.Selectable (Host, TCPPort) ActivityState m where
  select = A.lookup

instance HasMemPeerDB m => A.Alters (Host, TCPPort) ActivityState m where
  lookup _ (host, _) = do
    peerMap <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ fmap (toActivityState . pPeerActiveState) $ M.lookup host peerMap
  insert _ (host, _) a = do
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at host . _Just %~ \p -> p {pPeerActiveState = fromActivityState a}
  delete _ _ = error "Test peer should not be deleting activity states"
  
instance Mod.Accessible ActivePeers m where
  access = error "'Mod.Accessible ActivePeers m' not implemented"
  
instance HasMemPeerDB m => A.Replaceable (Host, UDPPort) PeerBondingState m where
  replace _ (host, _) (PeerBondingState s) = do
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at host . _Just %~ (\p -> p {pPeerBondState = s})

instance HasMemPeerDB m => A.Replaceable (Host, TCPPort) PeerBondingState m where
  replace _ (host, _) (PeerBondingState s) = do
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at host . _Just %~ (\p -> p {pPeerBondState = s})

instance HasMemPeerDB m => Mod.Accessible BondedPeers m where
  access _ = do
    currentTime <- liftIO getCurrentTime
    host <- accessEnvVar p2pMyIPAddress
    let f p = pPeerBondState p == 2 && pPeerEnableTime p < currentTime && pPeerHost p /= host
    peerMap <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ BondedPeers $ filter f $ M.elems peerMap
    
instance HasMemPeerDB m => Mod.Accessible BondedPeersForUDP m where
  access _ = do
    currentTime <- liftIO getCurrentTime
    host <- accessEnvVar p2pMyIPAddress
    let f p = pPeerBondState p == 2 && pPeerUdpEnableTime p < currentTime && pPeerHost p /= host
    peerMap <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ BondedPeersForUDP $ filter f $ M.elems peerMap

instance HasMemPeerDB m => Mod.Accessible UnbondedPeersForUDP m where
  access _ = do
    currentTime <- liftIO getCurrentTime
    host <- accessEnvVar p2pMyIPAddress
    let f p = pPeerBondState p == 0 && pPeerUdpEnableTime p < currentTime && pPeerHost p /= host
    peerMap <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ UnbondedPeersForUDP $ filter f $ M.elems $ peerMap

instance HasMemPeerDB m => A.Selectable Host ClosestPeers m where
  select _ t = do
    peerMap <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ Just $ ClosestPeers $ filter f $ M.elems peerMap
    where
      f p = pPeerHost p /= t && pPeerPubkey p /= Nothing

instance HasMemPeerDB m => A.Replaceable PPeer UdpEnableTime m where
  replace _ peer' (UdpEnableTime enableTime) = do
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at (pPeerHost peer') . _Just %~ (\p -> p {pPeerUdpEnableTime = enableTime})

instance HasMemPeerDB m => A.Replaceable PPeer TcpEnableTime m where
  replace _ peer' (TcpEnableTime enableTime) = do
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at (pPeerHost peer') . _Just %~ (\p -> p {pPeerEnableTime = enableTime})

instance HasMemPeerDB m => A.Replaceable PPeer PeerDisable m where
  replace _ peer' d = do
    peerMap <- fmap stringPPeerMap accessEnv
    case d of
      ExtendPeerDisableTime (TcpEnableTime enableTime) nextDisableWindowFactor ->
        modifyIORef peerMap $ at (pPeerHost peer') . _Just %~ (\p -> p {pPeerEnableTime = enableTime, pPeerNextDisableWindowSeconds = pPeerNextDisableWindowSeconds p * nextDisableWindowFactor})
      SetPeerDisableTime (TcpEnableTime enableTime) nextDisableWindow disableExpiration ->
        modifyIORef peerMap $ at (pPeerHost peer') . _Just %~ (\p -> p {pPeerEnableTime = enableTime, pPeerNextDisableWindowSeconds = nextDisableWindow, pPeerDisableExpiration = disableExpiration})

instance HasMemPeerDB m => A.Replaceable PPeer PeerUdpDisable m where
  replace _ peer' d = do
    currentTime <- liftIO getCurrentTime
    peerMap <- fmap stringPPeerMap accessEnv    
    case d of
      ExtendPeerUdpDisableTime (UdpEnableTime enableTime) nextDisableWindowFactor ->
        modifyIORef peerMap $ at (pPeerHost peer') . _Just %~ (\p -> p {pPeerUdpEnableTime = enableTime, pPeerNextUdpDisableWindowSeconds = pPeerNextUdpDisableWindowSeconds p * nextDisableWindowFactor})
      SetPeerUdpDisableTime (UdpEnableTime enableTime) nextDisableWindow disableExpiration ->
        modifyIORef peerMap $ at (pPeerHost peer') . _Just %~ (\p -> p {pPeerUdpEnableTime = enableTime, pPeerNextUdpDisableWindowSeconds = nextDisableWindow, pPeerDisableExpiration = disableExpiration})
      ResetPeerUdpDisable ->
        modifyIORef peerMap $ at (pPeerHost peer') . _Just %~ (\p -> p {pPeerUdpEnableTime = currentTime, pPeerNextUdpDisableWindowSeconds = 5, pPeerDisableExpiration = currentTime})

instance HasMemPeerDB m => A.Replaceable PPeer T.Text m where
  replace _ peer' e = do
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at (pPeerHost peer') . _Just %~ (\p -> p {pPeerDisableException = e})

instance HasMemPeerDB m => A.Replaceable T.Text PPeer m where
  replace _ message peer' = do
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at (pPeerHost peer') . _Just %~ (\p -> p {pPeerLastMsg = message})

toActivityState :: Int -> ActivityState
toActivityState 1 = Active
toActivityState _ = Inactive

fromActivityState :: ActivityState -> Int
fromActivityState Active = 1
fromActivityState Inactive = 0

