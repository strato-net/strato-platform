{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TupleSections         #-}
{-# LANGUAGE UndecidableInstances  #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Discovery.Data.MemPeerDB where

import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.Host
import           Control.Lens                          hiding (Context, view)
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Composable.Base
import           Control.Monad.Reader
import           Crypto.Types.PubKey.ECC               (Point)
import           Data.IP
import           Data.Map                              (Map)
import qualified Data.Map                              as M
import           Data.Maybe
import qualified Data.Text                             as T
import           Data.Time.Clock                       (getCurrentTime)
import           Numeric.Natural
import           UnliftIO

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

instance HasMemPeerDB m => A.Alters Host PPeer m where
  lookup _ host = do
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    return $ M.lookup host peerMap
  insert _ host p = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ \m -> (M.insert host p m, ())
  delete _ host = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ \m -> (M.delete host m, ())

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable Host PPeer (MemPeerDBM m) where
  select = A.lookup

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable (Host, Point) PeerBondingState (MemPeerDBM m) where
  select _ (ip, _) = do
    map' <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ PeerBondingState . pPeerBondState <$> map' M.!? ip

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable Host PPeer (MemPeerDBM m) where
  replace = A.insert

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable (Host, Point) PeerBondingState (MemPeerDBM m) where
  replace _ (h, _) (PeerBondingState s) = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . M.adjust (\p -> p{pPeerBondState = s}) h

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable PPeer PeerLastBestBlockHash (MemPeerDBM m) where
  replace _ p (PeerLastBestBlockHash h) = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . M.adjust (\p' -> p'{pPeerLastBestBlockHash = h}) (pPeerHost p)

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible AvailablePeers (MemPeerDBM m) where
  access _ = do
    currentTime <- liftIO getCurrentTime
    host <- accessEnvVar p2pMyIPAddress
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    return $ AvailablePeers $ filter ((< currentTime) . pPeerUdpEnableTime) $ filter ((/= host) . pPeerHost) $ M.elems peerMap

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable (Host, TCPPort) ActivityState (MemPeerDBM m) where
  replace = A.insert

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable (Host, TCPPort) ActivityState (MemPeerDBM m) where
  select = A.lookup

instance {-# OVERLAPPING #-} MonadIO m => A.Alters (Host, TCPPort) ActivityState (MemPeerDBM m) where
  lookup _ (host, _) = do
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    return $ toActivityState . pPeerActiveState <$> M.lookup host peerMap
  insert _ (host, _) a = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix host %~ \p -> p {pPeerActiveState = fromActivityState a})
  delete _ _ = error "Test peer should not be deleting activity states"

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible ActivePeers (MemPeerDBM m) where
  access _ = do 
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    return . ActivePeers . filter ((== Active) . toActivityState . pPeerActiveState) $ M.elems peerMap

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable (Host, UDPPort) PeerBondingState (MemPeerDBM m) where
  replace _ (host, _) (PeerBondingState s) = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix host %~ (\p -> p {pPeerBondState = s}))

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable (Host, TCPPort) PeerBondingState (MemPeerDBM m) where
  replace _ (host, _) (PeerBondingState s) = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix host %~ (\p -> p {pPeerBondState = s}))

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible BondedPeers (MemPeerDBM m) where
  access _ = do
    currentTime <- liftIO getCurrentTime
    host <- accessEnvVar p2pMyIPAddress
    let f p = pPeerBondState p == 2 && pPeerEnableTime p < currentTime && pPeerHost p /= host
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    return $ BondedPeers $ filter f $ M.elems peerMap

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible BondedPeersForUDP (MemPeerDBM m) where
  access _ = do
    currentTime <- liftIO getCurrentTime
    host <- accessEnvVar p2pMyIPAddress
    let f p = pPeerBondState p == 2 && pPeerUdpEnableTime p < currentTime && pPeerHost p /= host
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    return $ BondedPeersForUDP $ filter f $ M.elems peerMap

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible UnbondedPeersForUDP (MemPeerDBM m) where
  access _ = do
    currentTime <- liftIO getCurrentTime
    host <- accessEnvVar p2pMyIPAddress
    let f p = pPeerBondState p == 0 && pPeerUdpEnableTime p < currentTime && pPeerHost p /= host
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    return $ UnbondedPeersForUDP $ filter f $ M.elems peerMap

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable (Point, Natural) ClosestPeers (MemPeerDBM m) where
  select _ (point, lim) = do
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    pure . Just . ClosestPeers . take (fromIntegral lim) . filter f . M.elems $ pointPeerMap peerMap
    where
      f p = pPeerPubkey p /= Just point && pPeerPubkey p /= Nothing
      pointPeerMap = M.fromList . catMaybes . map (\p -> (,p) <$> pPeerPubkey p) . M.elems

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable IP PPeer (MemPeerDBM m) where
  select _ ip = do
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    pure . listToMaybe $ filter f $ M.elems peerMap
    where
      f p = pPeerIp p == Just ip

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable PPeer UdpEnableTime (MemPeerDBM m) where
  replace _ peer' (UdpEnableTime enableTime) = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerUdpEnableTime = enableTime}))

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable PPeer TcpEnableTime (MemPeerDBM m) where
  replace _ peer' (TcpEnableTime enableTime) = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerEnableTime = enableTime}))

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable PPeer PeerDisable (MemPeerDBM m) where
  replace _ peer' d = do
    peerMap <- fmap stringPPeerMap accessEnv
    case d of
      ExtendPeerDisableTime (TcpEnableTime enableTime) nextDisableWindowFactor ->
        atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerEnableTime = enableTime, pPeerNextDisableWindowSeconds = pPeerNextDisableWindowSeconds p * nextDisableWindowFactor}))
      SetPeerDisableTime (TcpEnableTime enableTime) nextDisableWindow disableExpiration ->
        atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerEnableTime = enableTime, pPeerNextDisableWindowSeconds = nextDisableWindow, pPeerDisableExpiration = disableExpiration}))

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable PPeer PeerUdpDisable (MemPeerDBM m) where
  replace _ peer' d = do
    currentTime <- liftIO getCurrentTime
    peerMap <- fmap stringPPeerMap accessEnv
    case d of
      ExtendPeerUdpDisableTime (UdpEnableTime enableTime) nextDisableWindowFactor ->
        atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerUdpEnableTime = enableTime, pPeerNextUdpDisableWindowSeconds = pPeerNextUdpDisableWindowSeconds p * nextDisableWindowFactor}))
      SetPeerUdpDisableTime (UdpEnableTime enableTime) nextDisableWindow disableExpiration ->
        atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerUdpEnableTime = enableTime, pPeerNextUdpDisableWindowSeconds = nextDisableWindow, pPeerDisableExpiration = disableExpiration}))
      ResetPeerUdpDisable ->
        atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerUdpEnableTime = currentTime, pPeerNextUdpDisableWindowSeconds = 5, pPeerDisableExpiration = currentTime}))

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable PPeer T.Text (MemPeerDBM m) where
  replace _ peer' e = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerDisableException = e}))

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable T.Text PPeer (MemPeerDBM m) where
  replace _ message peer' = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerLastMsg = message}))

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable PPeer IP (MemPeerDBM m) where
  replace _ peer' ip = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerIp = Just ip}))

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable PPeer Point (MemPeerDBM m) where
  replace _ peer' point = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerPubkey = Just point}))

toActivityState :: Int -> ActivityState
toActivityState 1 = Active
toActivityState _ = Inactive

fromActivityState :: ActivityState -> Int
fromActivityState Active   = 1
fromActivityState Inactive = 0

