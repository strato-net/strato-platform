module Blockchain.Strato.Discovery.P2PUtil
  (
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
