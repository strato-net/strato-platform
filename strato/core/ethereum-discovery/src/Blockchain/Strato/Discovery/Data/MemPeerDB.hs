{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

module Blockchain.Strato.Discovery.Data.MemPeerDB where

import Blockchain.Strato.Discovery.Data.Peer
import Control.Monad.Composable.Base
import Control.Monad.Reader
import Data.IORef
import Data.Map (Map)
import qualified Data.Map as Map
import qualified Data.Text as T

data MemPeerDBEnv = MemPeerDBEnv {
  p2pMyIPAddress :: IPAsText,
  stringPPeerMap :: IORef (Map String PPeer)
}

type MemPeerDBM = ReaderT MemPeerDBEnv

type HasMemPeerDB m = (MonadIO m, AccessibleEnv MemPeerDBEnv m)

createMemPeerDBEnv :: MonadIO m =>
                      IPAsText -> [PPeer] -> m MemPeerDBEnv
createMemPeerDBEnv me peers = do
  peerMap <- liftIO $ newIORef $ Map.fromList $ map (\p -> (T.unpack $ pPeerIp p, p)) peers

  return $ MemPeerDBEnv me peerMap
                                 
runMemPeerDBMUsingEnv :: MemPeerDBEnv -> MemPeerDBM m a -> m a
runMemPeerDBMUsingEnv env f =
  runReaderT f env
    
runMemPeerDBM :: MonadIO m => IPAsText -> [PPeer] -> MemPeerDBM m a -> m a
runMemPeerDBM me peers f = flip runMemPeerDBMUsingEnv f =<< createMemPeerDBEnv me peers
