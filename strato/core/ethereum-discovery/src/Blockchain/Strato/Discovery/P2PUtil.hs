module Blockchain.Strato.Discovery.P2PUtil
  ( sockAddrToIP,
    DiscoverException (..),
  )
where

import Control.Exception.Base (Exception)
import Data.List (intercalate)
import Data.Typeable (Typeable)
import qualified Network.Socket as S
import Numeric (showHex)

data DiscoverException
  = AffineException
  | ByteStringLengthException String
  | IPFormatException String
  | MalformedUDPException String
  | MissingPortException String
  | NoPublicKeyException
  deriving (Show, Typeable)

instance Exception DiscoverException

sockAddrToIP :: S.SockAddr -> String
sockAddrToIP (S.SockAddrInet6 _ _ host _) = let (a, b, c, d, e, f, g, h) = S.hostAddress6ToTuple host in intercalate ":" $ flip showHex "" <$> [a, b, c, d, e, f, g, h] -- horrible!!
sockAddrToIP (S.SockAddrUnix str) = str
sockAddrToIP addr' = takeWhile (/= ':') (show addr')
