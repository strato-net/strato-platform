module Blockchain.Strato.Discovery.P2PUtil
  (
    DiscoverException (..),
  )
where

import Control.Exception.Base (Exception)
import Data.Typeable (Typeable)

data DiscoverException
  = AffineException
  | ByteStringLengthException String
  | IPFormatException String
  | MalformedUDPException String
  | MissingPortException String
  | NoPublicKeyException
  deriving (Show, Typeable)

instance Exception DiscoverException
