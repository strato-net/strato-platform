{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeFamilies      #-}

module Blockchain.DeLoopNotify (
   deLoopSource
  ) where

import           Conduit
import           Control.Concurrent   (threadDelay)
import           Control.Monad
import           Blockchain.Output
import           Data.ByteString      (ByteString)
import qualified Data.Text            as T

import           Blockchain.Event
import           Blockchain.P2PRPC
import           Blockchain.P2PUtil

deLoopSource :: ( MonadIO m
                , MonadLogger m
                )
             => ByteString
             -> CommPort
             -> String
             -> ConduitM () Event m ()
deLoopSource commHost commPort peerIP = forever $ do
  resolveIPOrHost peerIP >>= \case
    Left err -> $logInfoS "deLoopSource" . T.pack $ "Couldn't resolve IP or Host " ++ (show peerIP) ++ ": " ++ show err
    Right resolvedPeerIPs -> (liftIO (getPeersIO commHost commPort)) >>= \case
      Left err -> $logInfoS "deLoopSource" . T.pack $ "Couldn't do RPC call to " ++ (show (peerIP, unCommPort commPort)) ++ ": " ++ show err
      Right otherServicePeers -> do
        resolvedRPCPeers <- sequence $ resolveQuietly <$> otherServicePeers
        let otherServiceIPs = (concat resolvedRPCPeers)
            isInLoopState = any (`elem` otherServiceIPs) resolvedPeerIPs
        when isInLoopState (yield $ AbortEvt "shhh... already connected to this peer via the other P2P service")
  liftIO (threadDelay 5000000)

  where resolveQuietly :: (MonadIO m, MonadLogger m) => RPCPeer -> m [String]
        resolveQuietly RPCPeer{rpcPeerIP = pip} = resolveIPOrHost pip >>= \case
          Left err -> do
            $logInfoS "deLoopSource" . T.pack $ "Failed to resolve " ++ show pip ++ ": " ++ err
            return []
          Right ips -> return ips

