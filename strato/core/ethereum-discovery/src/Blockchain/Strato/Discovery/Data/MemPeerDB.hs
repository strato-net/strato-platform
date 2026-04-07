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
import           Control.Monad.Composable.Base
import           Control.Monad.Reader
import           Data.IP
import           Data.Map                              (Map)
import qualified Data.Map                              as M
import           Data.Maybe
import           Data.Time.Clock                       (getCurrentTime)
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

instance {-# OVERLAPPING #-} MonadUnliftIO m => HasPeerDB (MemPeerDBM m) where
  getNumAvailablePeers = do
    currentTime <- liftIO getCurrentTime
    host <- accessEnvVar p2pMyIPAddress
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    return . length . filter ((< currentTime) . pPeerUdpEnableTime) $ filter ((/= host) . pPeerHost) $ M.elems peerMap

  setPeerActiveState host _ a = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix host %~ \p -> p {pPeerActiveState = fromActivityState a})

  getActivePeers = try $ do
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    return . filter ((== Active) . toActivityState . pPeerActiveState) $ M.elems peerMap

  setPeerBondingState h _ s = try $ do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . M.adjust (\p -> p{pPeerBondState = s}) h

  getPeerBondingState h _ = do
    map' <- readIORef =<< fmap stringPPeerMap accessEnv
    return $ pPeerBondState <$> map' M.!? h

  getBondedPeers = try $ do
    currentTime <- liftIO getCurrentTime
    host <- accessEnvVar p2pMyIPAddress
    let f p = pPeerBondState p == 2 && pPeerEnableTime p < currentTime && pPeerHost p /= host
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    return . filter f $ M.elems peerMap

  getBondedPeersForUDP = try $ do
    currentTime <- liftIO getCurrentTime
    host <- accessEnvVar p2pMyIPAddress
    let f p = pPeerBondState p == 2 && pPeerUdpEnableTime p < currentTime && pPeerHost p /= host
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    return . filter f $ M.elems peerMap

  getUnbondedPeers = do
    currentTime <- liftIO getCurrentTime
    host <- accessEnvVar p2pMyIPAddress
    let f p = pPeerBondState p == 0 && pPeerUdpEnableTime p < currentTime && pPeerHost p /= host
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    return . filter f $ M.elems peerMap

  getClosestPeers point lim = do
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    pure . take (fromIntegral lim) . filter f . M.elems $ pointPeerMap peerMap
    where
      f p = pPeerPubkey p /= Just point && pPeerPubkey p /= Nothing
      pointPeerMap = M.fromList . catMaybes . map (\p -> (,p) <$> pPeerPubkey p) . M.elems

  updateUdpEnableTime peer' enableTime = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerUdpEnableTime = enableTime}))

  updateIP peer' ip = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerIp = Just ip}))
  updateTcpEnableTime peer' enableTime = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerEnableTime = enableTime}))

  updatePeerDisable peer' d = do
    peerMap <- fmap stringPPeerMap accessEnv
    case d of
      ExtendPeerDisableTime (TcpEnableTime enableTime) nextDisableWindowFactor ->
        atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerEnableTime = enableTime, pPeerNextDisableWindowSeconds = pPeerNextDisableWindowSeconds p * nextDisableWindowFactor}))
      SetPeerDisableTime (TcpEnableTime enableTime) nextDisableWindow disableExpiration ->
        atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerEnableTime = enableTime, pPeerNextDisableWindowSeconds = nextDisableWindow, pPeerDisableExpiration = disableExpiration}))

  updatePeerLastBestBlockHash p (PeerLastBestBlockHash h) = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . M.adjust (\p' -> p'{pPeerLastBestBlockHash = h}) (pPeerHost p)

  updatePeerUdpDisable peer' d = do
    currentTime <- liftIO getCurrentTime
    peerMap <- fmap stringPPeerMap accessEnv
    case d of
      ExtendPeerUdpDisableTime (UdpEnableTime enableTime) nextDisableWindowFactor ->
        atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerUdpEnableTime = enableTime, pPeerNextUdpDisableWindowSeconds = pPeerNextUdpDisableWindowSeconds p * nextDisableWindowFactor}))
      SetPeerUdpDisableTime (UdpEnableTime enableTime) nextDisableWindow disableExpiration ->
        atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerUdpEnableTime = enableTime, pPeerNextUdpDisableWindowSeconds = nextDisableWindow, pPeerDisableExpiration = disableExpiration}))
      ResetPeerUdpDisable ->
        atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerUdpEnableTime = currentTime, pPeerNextUdpDisableWindowSeconds = 5, pPeerDisableExpiration = currentTime}))

  setPeerPubkey peer' point = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerPubkey = Just point}))

  storeDisableException peer' e = try $ do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerDisableException = e}))

  updateLastMessage peer' message = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . (ix (pPeerHost peer') %~ (\p -> p {pPeerLastMsg = message}))

  resetAllPeerTimeouts = do
    peerMap <- fmap stringPPeerMap accessEnv
    atomicModifyIORef' peerMap $ (,()) . M.map (\p -> p {
      pPeerBondState = 0,
      pPeerEnableTime = jamshidBirth,
      pPeerUdpEnableTime = jamshidBirth
    })

instance (MonadTrans t, Monad m, HasPeerDB m) => HasPeerDB (t m) where
  getNumAvailablePeers = lift getNumAvailablePeers
  setPeerActiveState a b c = lift $ setPeerActiveState a b c
  getActivePeers = lift getActivePeers
  setPeerBondingState a b c = lift $ setPeerBondingState a b c
  getPeerBondingState a b = lift $ getPeerBondingState a b
  getBondedPeers = lift getBondedPeers
  getBondedPeersForUDP = lift getBondedPeersForUDP
  getUnbondedPeers = lift getUnbondedPeers
  getClosestPeers a b = lift $ getClosestPeers a b
  updateUdpEnableTime a b = lift $ updateUdpEnableTime a b
  updateIP a b = lift $ updateIP a b
  updateTcpEnableTime a b = lift $ updateTcpEnableTime a b
  updatePeerDisable a b = lift $ updatePeerDisable a b
  updatePeerLastBestBlockHash a b = lift $ updatePeerLastBestBlockHash a b
  updatePeerUdpDisable a b = lift $ updatePeerUdpDisable a b
  setPeerPubkey a b = lift $ setPeerPubkey a b
  storeDisableException a b = lift $ storeDisableException a b
  updateLastMessage a b = lift $ updateLastMessage a b
  resetAllPeerTimeouts = lift resetAllPeerTimeouts

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

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable Host PPeer (MemPeerDBM m) where
  replace = A.insert

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable IP PPeer (MemPeerDBM m) where
  select _ ip = do
    peerMap <- readIORef . stringPPeerMap =<< accessEnv
    pure . listToMaybe $ filter f $ M.elems peerMap
    where
      f p = pPeerIp p == Just ip

toActivityState :: Int -> ActivityState
toActivityState 1 = Active
toActivityState _ = Inactive

fromActivityState :: ActivityState -> Int
fromActivityState Active   = 1
fromActivityState Inactive = 0

