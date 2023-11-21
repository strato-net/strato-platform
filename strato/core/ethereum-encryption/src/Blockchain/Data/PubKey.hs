{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.PubKey
  ( stringToPoint,
    pointToString,
    pointToBytes,
    bytesToPoint,
    secPubKeyToPoint,
    pointToSecPubKey,
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.ExtendedWord
import qualified Blockchain.Strato.Model.Secp256k1 as Secp256k1
import Crypto.Types.PubKey.ECC
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Maybe
import Data.Word
import qualified Text.Colors as CL
import Text.Format

-- TODO: maybe move to own module? not sure this instance makes sense here
instance Ord Point where 
  compare PointO PointO = EQ
  compare PointO _ = GT
  compare _ PointO = LT
  compare (Point x1 y1) (Point x2 y2) = case compare x1 x2 of 
    EQ -> compare y1 y2
    theComp -> theComp

stringToPoint :: String -> Point
stringToPoint string =
  case B16.decode $ BC.pack string of
    Right val -> bytesToPoint val
    _ -> error $ "stringToPoint called with malformed string: " ++ string

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

pointToBytes :: Point -> B.ByteString
pointToBytes (Point x y) = B.pack $ intToBytes x ++ intToBytes y
pointToBytes PointO = error "pointToBytes got value PointO, I don't know what to do here"

bytesToPoint :: B.ByteString -> Point
bytesToPoint bs
  | B.length bs == 64 =
    let (xs, ys) = B.splitAt 32 bs
     in Point (toInteger $ bytesToWord256 xs) (toInteger $ bytesToWord256 ys)
bytesToPoint _ = error "bytesToPoint called with the wrong number of bytes"

intToBytes :: Integer -> [Word8]
intToBytes x = map (fromIntegral . (x `shiftR`)) [256 - 8, 256 - 16 .. 0]

-- TODO: eventually, secp256k1 is the ONLY library we should use (no Point conversions)
secPubKeyToPoint :: Secp256k1.PublicKey -> Point
secPubKeyToPoint pub =
  let pkbs = B.drop 1 $ Secp256k1.exportPublicKey False pub
   in bytesToPoint pkbs

pointToSecPubKey :: Point -> Secp256k1.PublicKey
pointToSecPubKey pt =
  let pkbs = B.singleton 0x04 `B.append` pointToBytes pt -- 0x04 indicates this is a SEC serialized pubkey
      err = "could not convert point to secp256k1 public key: " ++ show pt
   in fromMaybe (error err) (Secp256k1.importPublicKey pkbs)
