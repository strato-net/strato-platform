
module Blockchain.Strato.Discovery.P2PUtil (
  sockAddrToIP,
  DiscoverException(..)
  ) where

import           Control.Exception.Base    (Exception)

import           Data.Typeable             (Typeable)

import qualified Network.Socket            as S


data DiscoverException = AffineException
                       | ByteStringLengthException String
                       | IPFormatException String
                       | MalformedUDPException String
                       | MissingPortException String
                       | NoPublicKeyException
                         deriving (Show, Typeable)

instance Exception DiscoverException


sockAddrToIP :: S.SockAddr -> String
sockAddrToIP (S.SockAddrInet6 _ _ host _) = show host
sockAddrToIP (S.SockAddrUnix str)         = str
sockAddrToIP addr'                        = takeWhile (/= ':') (show addr')
