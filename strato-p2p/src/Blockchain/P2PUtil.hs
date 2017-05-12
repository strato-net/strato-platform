{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.P2PUtil
  ( hPubKeyToPubKey
  , ecdsaSign
  , sockAddrToIP
  , looksLikeHostname
  , resolveHostname
  , resolveIPOrHost
  , DeloopException(..)
  , isAlreadyConnected
  ) where

import           Network.Haskoin.Crypto
import qualified Network.Socket                  as S

import           Blockchain.ExtendedECDSA
import           Blockchain.Strato.Discovery.UDP
import           Control.Arrow                   ((>>>))
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Crypto.Types.PubKey.ECC
import qualified Data.ByteString.Char8           as BC
import           Data.IP                         (IPv4)
import           Data.Maybe
import           Data.Semigroup
import qualified Data.Text                       as T hiding (takeWhile)
import           Network.DNS.Lookup
import           Network.DNS.Resolver
import           Network.DNS.Types               (DNSError)
import           Network.DNS.Utils               (normalize)
import qualified Network.Haskoin.Internals       as H

import           Blockchain.P2PRPC
import qualified System.IO.Unsafe                as I_AM_A_VILE_EXCUSE_FOR_A_HUMAN_BEING

hPubKeyToPubKey :: H.PubKey -> Point
hPubKeyToPubKey pubKey = Point (fromIntegral x) (fromIntegral y)
  where
     x = fromMaybe (error "getX failed in prvKey2Address") $ H.getX hPoint
     y = fromMaybe (error "getY failed in prvKey2Address") $ H.getY hPoint
     hPoint = H.pubKeyPoint pubKey

ecdsaSign :: H.PrvKey -> Word256 -> H.SecretT IO ExtendedSignature
ecdsaSign = flip extSignMsg

sockAddrToIP :: S.SockAddr -> String
sockAddrToIP (S.SockAddrInet6 _ _ host _) = show host
sockAddrToIP s@S.SockAddrInet{}           = takeWhile (/=':') (show s)
sockAddrToIP (S.SockAddrUnix str)         = str
sockAddrToIP (S.SockAddrCan addr)         = show addr -- the guy who wanted to run us on RasPi can now do it with CANBus

looksLikeHostname :: String -> Bool
looksLikeHostname = stringToIAddr >>> \case
  HostName _ -> True
  _          -> False

globalResolvSeed :: ResolvSeed
globalResolvSeed = I_AM_A_VILE_EXCUSE_FOR_A_HUMAN_BEING.unsafePerformIO (makeResolvSeed defaultResolvConf)
{-# NOINLINE globalResolvSeed #-}

resolveHostname :: (MonadIO m, MonadLogger m) => String -> m (Either String [String])
resolveHostname hn = lookupARecords >>= \case
  Left err  -> return . Left $ "resolveHostname: Couldnt resolve hostname " ++ show hn ++  ": " ++ show err
  Right ips -> return . Right $ show <$> ips

  where lookupARecords :: MonadIO m => m (Either DNSError [IPv4])
        lookupARecords = liftIO $ withResolver globalResolvSeed (flip lookupA . normalize $ BC.pack hn)

resolveIPOrHost :: (MonadIO m, MonadLogger m) => String -> m (Either String [String])
resolveIPOrHost host | looksLikeHostname host = resolveHostname host
                     | otherwise = return (Right [host])

data DeloopException = FailedToResolvePeer String
                     | FailedToCallRPC String
                     deriving (Eq, Read, Show)

isAlreadyConnected :: (MonadLogger m, MonadIO m)
                   => BC.ByteString -- remote service host
                   -> CommPort -- remote service port
                   -> String -- IP address / host of peer
                   -> m (Either DeloopException Bool)
isAlreadyConnected otherHost otherPort peerAddress = resolveIPOrHost peerAddress >>= \case
  Left err -> do
    $logInfoS "isAlreadyConnected" . T.pack $ "Failed to resolve " ++ show peerAddress ++ ": " ++ err
    return . Left . FailedToResolvePeer $ show err -- pretend the connection already exists, for safety's sake
  Right asIPs -> do
    liftIO (getPeersIO otherHost otherPort) >>= \case
      Left err -> do
        $logInfoS "isAlreadyConnected" . T.pack $ "Failed to call RPC at " ++ BC.unpack otherHost ++ ": " ++ show err
        return . Left . FailedToCallRPC $ show err
      Right serverPeers -> do
        let found = any (`elem` serverPeerIPs) asIPs
            serverPeerIPs = rpcPeerIP <$> serverPeers
        $logInfoS "isAlreadyConnected" . T.pack $ peerAddress <> " -> " <> show asIPs <> " / " <> show serverPeerIPs <> " -> " <> show found
        return (Right found)

