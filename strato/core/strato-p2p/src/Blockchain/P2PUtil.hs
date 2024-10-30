{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.P2PUtil
  ( sockAddrToIP,
    resolveIPOrHost,
  )
where

import Blockchain.Strato.Discovery.UDP
import Control.Arrow ((>>>))
import Control.Monad.IO.Class
import qualified Data.ByteString.Char8 as BC
import Data.IP (IPv4)
import Data.List (intercalate)
import Network.DNS.Lookup
import Network.DNS.Resolver
import Network.DNS.Types (DNSError)
import Network.DNS.Utils (normalize)
import qualified Network.Socket as S
import Numeric (showHex)
import qualified System.IO.Unsafe as I_AM_A_VILE_EXCUSE_FOR_A_HUMAN_BEING

sockAddrToIP :: S.SockAddr -> String
sockAddrToIP (S.SockAddrInet6 _ _ host _) = let (a, b, c, d, e, f, g, h) = S.hostAddress6ToTuple host in intercalate ":" $ flip showHex "" <$> [a, b, c, d, e, f, g, h] -- horrible!!
sockAddrToIP s@S.SockAddrInet {} = takeWhile (/= ':') (show s)
sockAddrToIP (S.SockAddrUnix str) = str

looksLikeHostname :: String -> Bool
looksLikeHostname =
  stringToIAddr >>> \case
    HostName _ -> True
    _ -> False

globalResolvSeed :: ResolvSeed
globalResolvSeed = I_AM_A_VILE_EXCUSE_FOR_A_HUMAN_BEING.unsafePerformIO (makeResolvSeed defaultResolvConf)
{-# NOINLINE globalResolvSeed #-}

resolveHostname :: MonadIO m => String -> m (Either String [String])
resolveHostname hn =
  lookupARecords >>= \case
    Left err -> return . Left $ "resolveHostname: Couldnt resolve hostname " ++ show hn ++ ": " ++ show err
    Right ips -> return . Right $ show <$> ips
  where
    lookupARecords :: MonadIO m => m (Either DNSError [IPv4])
    lookupARecords = liftIO $ withResolver globalResolvSeed (flip lookupA . normalize $ BC.pack hn)

resolveIPOrHost :: MonadIO m => String -> m (Either String [String])
resolveIPOrHost host
  | looksLikeHostname host = resolveHostname host
  | otherwise = return (Right [host])

data DeloopException
  = FailedToResolvePeer String
  | FailedToCallRPC String
  deriving (Eq, Read, Show)
