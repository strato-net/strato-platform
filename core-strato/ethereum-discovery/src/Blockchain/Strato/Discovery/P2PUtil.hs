
module Blockchain.Strato.Discovery.P2PUtil (
  hPubKeyToPubKey,
  sockAddrToIP,
  DiscoverException(..)
  ) where

import           Control.Error             (note)
import           Control.Exception.Base    (Exception)

import           Data.Typeable             (Typeable)

import           Crypto.Types.PubKey.ECC   (Point (..))
import qualified Network.Haskoin.Internals as H
import qualified Network.Socket            as S


data DiscoverException = AffineException
                       | ByteStringLengthException String
                       | IPFormatException String
                       | MalformedUDPException String
                       | MissingPortException String
                       | NoPublicKeyException
                         deriving (Show, Typeable)

instance Exception DiscoverException

--I need to use two definitions of PubKey (internally they represent the same thing)
--The one in the Haskoin package allows me to recover signatures.
--The one in the crypto packages let me do AES encryption.
--At some point I have to convert from one PubKey to the other, this function
--lets me to that.
hPubKeyToPubKey :: H.PubKey -> Either DiscoverException Point
hPubKeyToPubKey pubKey = do
  let hPoint = H.pubKeyPoint pubKey
  x <- note AffineException $ H.getX hPoint
  y <- note AffineException $ H.getY hPoint
  return $ Point (fromIntegral x) (fromIntegral y)

sockAddrToIP :: S.SockAddr -> String
sockAddrToIP (S.SockAddrInet6 _ _ host _) = show host
sockAddrToIP (S.SockAddrUnix str)         = str
sockAddrToIP addr'                        = takeWhile (/= ':') (show addr')
