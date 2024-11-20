{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE UndecidableInstances #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Discovery.Data.MemPeerDB where

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
  p2pMyIPAddress :: IPAsText,
  stringPPeerMap :: IORef (Map String PPeer)
}

type MemPeerDBM = ReaderT MemPeerDBEnv

type HasMemPeerDB m = (MonadIO m, AccessibleEnv MemPeerDBEnv m)

createMemPeerDBEnv :: MonadIO m =>
                      IPAsText -> [PPeer] -> m MemPeerDBEnv
createMemPeerDBEnv me peers = do
  peerMap <- newIORef $ M.fromList $ map (\p -> (T.unpack $ pPeerIp p, p)) peers

  return $ MemPeerDBEnv me peerMap
                                 
runMemPeerDBMUsingEnv :: MemPeerDBEnv -> MemPeerDBM m a -> m a
runMemPeerDBMUsingEnv env f =
  runReaderT f env
    
runMemPeerDBM :: MonadIO m => IPAsText -> [PPeer] -> MemPeerDBM m a -> m a
runMemPeerDBM me peers f = flip runMemPeerDBMUsingEnv f =<< createMemPeerDBEnv me peers

instance HasMemPeerDB m => Mod.Accessible AvailablePeers m where
  access _ = do
    currentTime <- liftIO getCurrentTime
    IPAsText ip <- accessEnvVar p2pMyIPAddress
    peerMap <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ AvailablePeers $ filter ((< currentTime) . pPeerUdpEnableTime) $ filter ((/= ip) . pPeerIp) $ M.elems peerMap

instance A.Replaceable (IPAsText, TCPPort) ActivityState m where
  replace = error "'A.Replaceable (IPAsText, TCPPort) ActivityState m' not implemented"

instance HasMemPeerDB m => A.Selectable (IPAsText, TCPPort) ActivityState m where
  select = A.lookup

instance HasMemPeerDB m => A.Alters (IPAsText, TCPPort) ActivityState m where
  lookup _ (IPAsText t, _) = do
    peerMap <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ fmap (toActivityState . pPeerActiveState) $ M.lookup (T.unpack t) peerMap
  insert _ (IPAsText t, _) a = do
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at (T.unpack t) . _Just %~ \p -> p {pPeerActiveState = fromActivityState a}
  delete _ _ = error "Test peer should not be deleting activity states"
  
instance Mod.Accessible ActivePeers m where
  access = error "'Mod.Accessible ActivePeers m' not implemented"
  
instance HasMemPeerDB m => A.Replaceable (IPAsText, UDPPort) PeerBondingState m where
  replace _ (IPAsText t, _) (PeerBondingState s) = do
    let ip = T.unpack t
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at ip . _Just %~ (\p -> p {pPeerBondState = s})

instance HasMemPeerDB m => A.Replaceable (IPAsText, TCPPort) PeerBondingState m where
  replace _ (IPAsText t, _) (PeerBondingState s) = do
    let ip = T.unpack t
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at ip . _Just %~ (\p -> p {pPeerBondState = s})

instance HasMemPeerDB m => Mod.Accessible BondedPeers m where
  access _ = do
    currentTime <- liftIO getCurrentTime
    IPAsText ip <- accessEnvVar p2pMyIPAddress
    let f p = pPeerBondState p == 2 && pPeerEnableTime p < currentTime && pPeerIp p /= ip
    peerMap <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ BondedPeers $ filter f $ M.elems peerMap
    
instance HasMemPeerDB m => Mod.Accessible BondedPeersForUDP m where
  access _ = do
    currentTime <- liftIO getCurrentTime
    IPAsText ip <- accessEnvVar p2pMyIPAddress
    let f p = pPeerBondState p == 2 && pPeerUdpEnableTime p < currentTime && pPeerIp p /= ip
    peerMap <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ BondedPeersForUDP $ filter f $ M.elems peerMap

instance HasMemPeerDB m => Mod.Accessible UnbondedPeersForUDP m where
  access _ = do
    currentTime <- liftIO getCurrentTime
    IPAsText ip <- accessEnvVar p2pMyIPAddress
    let f p = pPeerBondState p == 0 && pPeerUdpEnableTime p < currentTime && pPeerIp p /= ip
    peerMap <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ UnbondedPeersForUDP $ filter f $ M.elems $ peerMap

instance HasMemPeerDB m => A.Selectable IPAsText ClosestPeers m where
  select _ (IPAsText t) = do
    peerMap <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ Just $ ClosestPeers $ filter f $ M.elems peerMap
    where
      f p = pPeerIp p /= t && pPeerPubkey p /= Nothing

instance HasMemPeerDB m => A.Replaceable PPeer UdpEnableTime m where
  replace _ peer' (UdpEnableTime enableTime) = do
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at (T.unpack $ pPeerIp peer') . _Just %~ (\p -> p {pPeerUdpEnableTime = enableTime})

instance HasMemPeerDB m => A.Replaceable PPeer TcpEnableTime m where
  replace _ peer' (TcpEnableTime enableTime) = do
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at (T.unpack $ pPeerIp peer') . _Just %~ (\p -> p {pPeerEnableTime = enableTime})

instance HasMemPeerDB m => A.Replaceable PPeer PeerDisable m where
  replace _ peer' d = do
    peerMap <- fmap stringPPeerMap accessEnv
    case d of
      ExtendPeerDisableTime (TcpEnableTime enableTime) nextDisableWindowFactor ->
        modifyIORef peerMap $ at (T.unpack $ pPeerIp peer') . _Just %~ (\p -> p {pPeerEnableTime = enableTime, pPeerNextDisableWindowSeconds = pPeerNextDisableWindowSeconds p * nextDisableWindowFactor})
      SetPeerDisableTime (TcpEnableTime enableTime) nextDisableWindow disableExpiration ->
        modifyIORef peerMap $ at (T.unpack $ pPeerIp peer') . _Just %~ (\p -> p {pPeerEnableTime = enableTime, pPeerNextDisableWindowSeconds = nextDisableWindow, pPeerDisableExpiration = disableExpiration})

instance HasMemPeerDB m => A.Replaceable PPeer PeerUdpDisable m where
  replace _ peer' d = do
    currentTime <- liftIO getCurrentTime
    peerMap <- fmap stringPPeerMap accessEnv    
    case d of
      ExtendPeerUdpDisableTime (UdpEnableTime enableTime) nextDisableWindowFactor ->
        modifyIORef peerMap $ at (T.unpack $ pPeerIp peer') . _Just %~ (\p -> p {pPeerUdpEnableTime = enableTime, pPeerNextUdpDisableWindowSeconds = pPeerNextUdpDisableWindowSeconds p * nextDisableWindowFactor})
      SetPeerUdpDisableTime (UdpEnableTime enableTime) nextDisableWindow disableExpiration ->
        modifyIORef peerMap $ at (T.unpack $ pPeerIp peer') . _Just %~ (\p -> p {pPeerUdpEnableTime = enableTime, pPeerNextUdpDisableWindowSeconds = nextDisableWindow, pPeerDisableExpiration = disableExpiration})
      ResetPeerUdpDisable ->
        modifyIORef peerMap $ at (T.unpack $ pPeerIp peer') . _Just %~ (\p -> p {pPeerUdpEnableTime = currentTime, pPeerNextUdpDisableWindowSeconds = 5, pPeerDisableExpiration = currentTime})

instance HasMemPeerDB m => A.Replaceable PPeer T.Text m where
  replace _ peer' e = do
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at (T.unpack $ pPeerIp peer') . _Just %~ (\p -> p {pPeerDisableException = e})

instance HasMemPeerDB m => A.Replaceable T.Text PPeer m where
  replace _ message peer' = do
    peerMap <- fmap stringPPeerMap accessEnv
    modifyIORef peerMap $ at (T.unpack $ pPeerIp peer') . _Just %~ (\p -> p {pPeerLastMsg = message})

toActivityState :: Int -> ActivityState
toActivityState 1 = Active
toActivityState _ = Inactive

fromActivityState :: ActivityState -> Int
fromActivityState Active = 1
fromActivityState Inactive = 0

