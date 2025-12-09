{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

{-# OPTIONS -fno-warn-orphans #-}

module Main (main) where

import BlockApps.Logging
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Discovery.Data.PeerIOWiring ()
import Control.Applicative ((<|>))
import Control.Concurrent (threadDelay)
import Control.Monad (forever, forM_, when)
import Control.Monad.IO.Class
import Data.Map (Map)
import qualified Data.Map as Map
import qualified Data.Text as T
import HFlags
import Network.Info
import NetworkInterface
import NetworkInterfaceEvent
import Text.Format

main :: IO ()
main = do
  _ <- $initHFlags "Strato Network Monitor"
  runLoggingT $ loop Map.empty   -- start with no network interfaces
  where
    loop :: (MonadIO m, MonadLogger m) => Map String NetworkInterface -> m ()
    loop old = forever $ do
      new <- liftIO $ getNetworkInterfaceMap
      if old /= new
        then do
          let diffs = Map.unionWith (\(a1,b1) (a2,b2) -> (a1 <|> a2, b1 <|> b2))
                      (fmap ((,Nothing) . Just) old)
                      (fmap ((Nothing,) . Just) new)
              events = Map.toList $ fmap (uncurry diffToEvent) diffs
              changes = [(o, n) | (_, Just (Changed o n)) <- events]
              connected = [i | (_, Just (Connected i)) <- events]
              disconnected = [i | (_, Just (Disconnected i)) <- events]

          forM_ connected $ \theInterface ->
            $logInfoS "main" $ T.pack $ "Connected: " ++ format theInterface
          forM_ disconnected $ \theInterface ->
            $logInfoS "main" $ T.pack $ "Disconnected: " ++ name theInterface
          forM_ changes $ \(oldInterface, newInterface) ->
            $logInfoS "main" $ T.pack $ "Changed from " ++ format oldInterface ++ " to " ++ format newInterface
          when (not $ null connected) $ do
            $logInfoS "main" $ T.pack $ "New IP address added, resetting all peer timeouts so that we can reconnect to all peers"
            liftIO resetAllPeerTimeouts
          loop new
        else do
            -- $logInfoS "main" "no change"
            -- no change, wait a bit
            liftIO $ threadDelay (5 * 1000000)  -- 5 seconds
            loop old
