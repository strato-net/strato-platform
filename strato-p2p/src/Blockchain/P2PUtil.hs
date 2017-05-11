{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.P2PUtil (
  hPubKeyToPubKey,
  ecdsaSign,
  sockAddrToIP,
  looksLikeHostname,
  resolveHostname,
  resolveIPOrHost
  ) where

import           Network.Haskoin.Crypto
import qualified Network.Socket                  as S

import           Blockchain.ExtendedECDSA
import           Blockchain.Strato.Discovery.UDP
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Crypto.Types.PubKey.ECC
import qualified Data.ByteString.Char8           as BC
import           Data.Maybe
import           Data.Semigroup
import           Data.Text                       as T hiding (takeWhile)
import           Network.DNS.Lookup
import           Network.DNS.Resolver
import           Network.DNS.Utils               (normalize)
import qualified Network.Haskoin.Internals       as H

import qualified System.IO.Unsafe                as I_AM_A_VILE_EXCUSE_FOR_A_HUMAN_BEING

hPubKeyToPubKey :: H.PubKey -> Point
hPubKeyToPubKey pubKey = Point (fromIntegral x) (fromIntegral y)
  where
     x = fromMaybe (error "getX failed in prvKey2Address") $ H.getX hPoint
     y = fromMaybe (error "getY failed in prvKey2Address") $ H.getY hPoint
     hPoint = H.pubKeyPoint pubKey

ecdsaSign :: H.PrvKey -> Word256 -> H.SecretT IO ExtendedSignature
ecdsaSign prvKey' theHash = do
    extSignMsg theHash prvKey'

sockAddrToIP :: S.SockAddr -> String
sockAddrToIP (S.SockAddrInet6 _ _ host _) = show host
sockAddrToIP (S.SockAddrUnix str)         = str
sockAddrToIP addr'                        = takeWhile (\t -> t /= ':') (show addr')

looksLikeHostname :: String -> Bool
looksLikeHostname pPeerIp = case stringToIAddr pPeerIp of
  HostName _ -> True
  _          -> False

globalResolvSeed :: ResolvSeed
globalResolvSeed = I_AM_A_VILE_EXCUSE_FOR_A_HUMAN_BEING.unsafePerformIO (makeResolvSeed defaultResolvConf)
{-# NOINLINE globalResolvSeed #-}

resolveHostname :: (MonadIO m, MonadLogger m) => String -> m (Either String [String])
resolveHostname hn = do
  liftIO (withResolver globalResolvSeed (flip lookupA (normalize $ BC.pack hn))) >>= \case
    Left err  -> return . Left $ "resolveHostname: Couldnt resolve hostname \"" <> hn <> "\": " <> show err
    Right ips -> return . Right $ show <$> ips

resolveIPOrHost :: (MonadIO m, MonadLogger m) => String -> m (Either String [String])
resolveIPOrHost host | looksLikeHostname host = resolveHostname host
                     | otherwise = return (Right [host])
