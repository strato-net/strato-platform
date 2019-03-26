{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.PubKey (
  stringToPoint,
  pointToString,
  pointToBytes,
  bytesToPoint,
  pubKeyToBytes
  ) where

import           Crypto.Types.PubKey.ECC
import           Data.Bits
import qualified Data.ByteString           as B
import qualified Data.ByteString.Base16    as B16
import qualified Data.ByteString.Char8     as BC
import           Data.Maybe
import           Data.Word
import qualified Network.Haskoin.Internals as H

import           Blockchain.Data.RLP
import           Blockchain.ExtWord
import qualified Text.Colors               as CL
import           Text.Format

stringToPoint::String->Point
stringToPoint string =
  case B16.decode $ BC.pack string of
   (val, "") -> bytesToPoint val
   _         -> error $ "stringToPoint called with malformed string: " ++ string

pointToString :: Point -> String
pointToString = BC.unpack . B16.encode . pointToBytes

instance Format Point where
  format x =
    CL.yellow (take 30 (format $ pointToBytes x) ++ "...")

instance RLPSerializable Point where
  rlpEncode (Point x y) =
    rlpEncode $ word256ToBytes (fromInteger x) <> word256ToBytes (fromInteger y)
  rlpEncode PointO = error "rlpEncode for Point called for PointO"
  rlpDecode o =
    Point (toInteger $ bytesToWord256 x) (toInteger $ bytesToWord256 y)
    where
      (x, y) = B.splitAt 32 $ rlpDecode o

{-
instance Format Point where
  format (Point x y) = padZeros 64 (showHex x "") ++ padZeros 64 (showHex y "")
  format PointO = "PointO"
-}

pointToBytes::Point->B.ByteString
pointToBytes (Point x y) = B.pack $ intToBytes x ++ intToBytes y
pointToBytes PointO      = error "pointToBytes got value PointO, I don't know what to do here"

hPointToBytes::H.Point->B.ByteString
hPointToBytes point = word256ToBytes (fromIntegral x) <> word256ToBytes (fromIntegral y)
  where
    x = fromMaybe (error "getX failed in prvKey2Address") $ H.getX point
    y = fromMaybe (error "getY failed in prvKey2Address") $ H.getY point

pubKeyToBytes::H.PubKey->B.ByteString
pubKeyToBytes pubKey = hPointToBytes $ H.pubKeyPoint pubKey

bytesToPoint::B.ByteString->Point
bytesToPoint bs | B.length bs == 64 =
  let (xs, ys)= B.splitAt 32 bs
  in Point (toInteger $ bytesToWord256 xs) (toInteger $ bytesToWord256 ys)
bytesToPoint _ = error "bytesToPoint called with the wrong number of bytes"

intToBytes::Integer->[Word8]
intToBytes x = map (fromIntegral . (x `shiftR`)) [256-8, 256-16..0]

