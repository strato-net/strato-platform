{-# LANGUAGE RecordWildCards #-}

{-# OPTIONS -fno-warn-orphans #-}

module NetworkInterface
  (
    NetworkInterface,
    getNetworkInterfaceMap,
    isDisconnected
  ) where

import Data.Map (Map)
import qualified Data.Map as Map
import Network.Info
import Text.Format

instance Eq NetworkInterface where
  x == y = show x == show y

instance Format NetworkInterface where
  format interface | isDisconnected interface =
                       name interface ++ ": disconnected, mac=" ++ show (mac interface)
  format NetworkInterface{..} =
    name ++ ": ip=" ++ show ipv4 ++ ", ipv6=" ++ show ipv6 ++ ", mac=" ++ show mac

getNetworkInterfaceMap :: IO (Map String NetworkInterface)
getNetworkInterfaceMap = do
  networkInterfaceList <- getNetworkInterfaces
  return $ Map.fromList $ map (\interface -> (name interface, interface)) networkInterfaceList

isDisconnected :: NetworkInterface -> Bool
isDisconnected NetworkInterface{..} | isUnspecifiedIPv4 ipv4 && isUnspecifiedIPv6 ipv6 = True
isDisconnected _ = False


isUnspecifiedIPv4 :: IPv4 -> Bool
isUnspecifiedIPv4 (IPv4 w) = w == 0

isUnspecifiedIPv6 :: IPv6 -> Bool
isUnspecifiedIPv6 (IPv6 a b c d) = a==0 && b==0 && c==0 && d==0
