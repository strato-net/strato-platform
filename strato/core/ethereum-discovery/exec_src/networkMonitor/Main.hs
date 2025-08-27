{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}

{-# OPTIONS -fno-warn-orphans #-}

module Main (main) where

import BlockApps.Logging
import Control.Concurrent (threadDelay)
import Control.Monad (forever, forM_)
import Control.Monad.IO.Class
import Data.Map (Map)
import qualified Data.Map as Map
import qualified Data.Text as T
import HFlags
import Network.Info

instance Eq NetworkInterface where
  x == y = show x == show y

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
          let added = new `Map.difference` old
              removed = old `Map.difference` new
              changed = Map.filter (\(o,n) -> o /= n) $ Map.intersectionWith (,) old new
          
          forM_ added $ \theInterface ->
            $logInfoS "main" $ T.pack $ "Adding interface: " ++ formatInterface theInterface
          forM_ removed $ \theInterface ->
            $logInfoS "main" $ T.pack $ "Removing interface: " ++ formatInterface theInterface
          forM_ changed $ \(oldInterface, newInterface) ->
            $logInfoS "main" $ T.pack $ formatInterfaceChange oldInterface newInterface
          resetPeers
          loop new
        else do
            -- $logInfoS "main" "no change"
            -- no change, wait a bit
            liftIO $ threadDelay (5 * 1000000)  -- 5 seconds
            loop old

formatInterface :: NetworkInterface -> String
formatInterface NetworkInterface{..} | isUnspecifiedIPv4 ipv4 && isUnspecifiedIPv6 ipv6 = name ++ ": disconnected, mac=" ++ show mac
formatInterface NetworkInterface{..} = name ++ ": ip=" ++ show ipv4 ++ ", ipv6=" ++ show ipv6 ++ ", mac=" ++ show mac

formatInterfaceChange :: NetworkInterface -> NetworkInterface -> String
formatInterfaceChange old new | name old /= name new = error "Internal error in call to formatInterface: trying to compare different interfaces"
formatInterfaceChange old new | mac old == mac new && isUnspecifiedIPv4 (ipv4 new) && isUnspecifiedIPv6 (ipv6 new) = (name old) ++ " has disconnected from the network"
formatInterfaceChange old new | mac old == mac new && isUnspecifiedIPv4 (ipv4 old) && isUnspecifiedIPv6 (ipv6 old) = (name old) ++ " has connected: ip=" ++ show (ipv4 new) ++ ", ipv6=" ++ show (ipv6 new)
formatInterfaceChange old new = "Changed from " ++ formatInterface old ++ " to " ++ formatInterface new

isUnspecifiedIPv4 :: IPv4 -> Bool
isUnspecifiedIPv4 (IPv4 w) = w == 0

isUnspecifiedIPv6 :: IPv6 -> Bool
isUnspecifiedIPv6 (IPv6 a b c d) = a==0 && b==0 && c==0 && d==0

getNetworkInterfaceMap :: IO (Map String NetworkInterface)
getNetworkInterfaceMap = do
  networkInterfaceList <- getNetworkInterfaces
  return $ Map.fromList $ map (\interface -> (name interface, interface)) networkInterfaceList
  
resetPeers :: MonadIO m => m ()
resetPeers = do
  liftIO $ putStrLn "<need to implement resetPeers>"
