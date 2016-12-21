{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.PubKey (
  stringToPoint,
  pointToBytes,
  bytesToPoint,
  pubKeyToBytes
  ) where

import Crypto.Types.PubKey.ECC
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Maybe
import Data.Word
import qualified Network.Haskoin.Internals as H

import qualified Blockchain.Colors as CL
import Blockchain.Data.RLP
import Blockchain.ExtWord
import Blockchain.Format

stringToPoint::String->Point
stringToPoint string =
  case B16.decode $ BC.pack string of
   (val, "") -> bytesToPoint $ B.unpack val
   _ -> error $ "stringToPoint called with malformed string: " ++ string

instance Format Point where
  format x = 
    CL.yellow (take 30 (format $ B.pack $ pointToBytes x) ++ "...")

instance RLPSerializable Point where
  rlpEncode (Point x y) =
    rlpEncode $ B.pack $ (word256ToBytes $ fromInteger x) ++ (word256ToBytes $ fromInteger y)
  rlpEncode PointO = error "rlpEncode for Point called for PointO"
  rlpDecode o =
    Point (toInteger $ bytesToWord256 $ B.unpack x) (toInteger $ bytesToWord256 $ B.unpack y)
    where
      (x, y) = B.splitAt 32 $ rlpDecode o

{-
instance Format Point where
  format (Point x y) = padZeros 64 (showHex x "") ++ padZeros 64 (showHex y "")
  format PointO = "PointO"
-}

pointToBytes::Point->[Word8]
pointToBytes (Point x y) = intToBytes x ++ intToBytes y
pointToBytes PointO = error "pointToBytes got value PointO, I don't know what to do here"

hPointToBytes::H.Point->[Word8]
hPointToBytes point =
  word256ToBytes (fromIntegral x) ++ word256ToBytes (fromIntegral y)
  where
    x = fromMaybe (error "getX failed in prvKey2Address") $ H.getX point
    y = fromMaybe (error "getY failed in prvKey2Address") $ H.getY point

pubKeyToBytes::H.PubKey->[Word8]
pubKeyToBytes pubKey = hPointToBytes $ H.pubKeyPoint pubKey

bytesToPoint::[Word8]->Point
bytesToPoint x | length x == 64 =
  Point (toInteger $ bytesToWord256 $ take 32 x) (toInteger $ bytesToWord256 $ drop 32 x)
bytesToPoint _ = error "bytesToPoint called with the wrong number of bytes"

intToBytes::Integer->[Word8]
intToBytes x = map (fromIntegral . (x `shiftR`)) [256-8, 256-16..0]

