{-# LANGUAGE ConstraintKinds #-}

module Blockchain.Strato.Discovery.Data.MemPeerDB where

import Blockchain.Strato.Discovery.Data.Peer
import Control.Monad.Composable.Base
import Control.Monad.Reader
import Data.IORef
import Data.Map (Map)
import qualified Data.Map as Map
import qualified Data.Text as T

data MemPeerDBEnv = MemPeerDBEnv {
  stringPPeerMap :: IORef (Map String PPeer)
}

type MemPeerDBM = ReaderT MemPeerDBEnv

type HasMemPeerDB = AccessibleEnv MemPeerDBEnv

createMemPeerDBEnv :: MonadIO m =>
                      [PPeer] -> m MemPeerDBEnv
createMemPeerDBEnv peers = do
  peerMap <- liftIO $ newIORef $ Map.fromList $ map (\p -> (T.unpack $ pPeerIp p, p)) peers

  return $ MemPeerDBEnv peerMap
                                 
runMemPeerDBMUsingEnv :: MemPeerDBEnv -> MemPeerDBM m a -> m a
runMemPeerDBMUsingEnv env f =
  runReaderT f env
    
runMemPeerDBM :: MonadIO m => [PPeer] -> MemPeerDBM m a -> m a
runMemPeerDBM peers f = flip runMemPeerDBMUsingEnv f =<< createMemPeerDBEnv peers
