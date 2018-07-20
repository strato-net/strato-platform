module Blockchain.Data.ChainId (
  ChainId(..),
  chainIdAsNibbleString,
  chainIdFromNibbleString,
  ) where

import           Data.Binary
import qualified Data.ByteString.Lazy            as BL
import qualified Data.NibbleString               as N

import           Blockchain.ExtWord              (Word256)
import           Blockchain.Util

newtype ChainId = ChainId { unChainId :: Maybe Word256 } deriving (Eq, Ord, Show)

-- instance Format ChainId where
--   format (ChainId Nothing) = "Public"
--   format (ChainId (Just w)) = "Private 0x" ++ showHex w

chainIdAsNibbleString:: Maybe Word256 -> N.NibbleString
chainIdAsNibbleString c = case c of
  Nothing -> N.empty
  Just w -> byteString2NibbleString $ BL.toStrict $ encode w

chainIdFromNibbleString :: N.NibbleString -> Maybe Word256
chainIdFromNibbleString n = if N.null n then Nothing else
  Just . decode . BL.fromStrict $ nibbleString2ByteString n
