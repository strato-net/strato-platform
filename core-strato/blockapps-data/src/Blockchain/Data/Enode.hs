{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE DeriveAnyClass     #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.Data.Enode
  ( Enode(..)
  , IPAddress(..)
  , ChainMembers(..)
  , ChainTxsInBlock(..)
  , IPChains(..)
  , showEnode
  , readEnode
  , showIP
  , readIP
  ) where


import           Control.DeepSeq
import           Data.Bits
import           Data.Binary
import qualified Data.ByteString         as B
import qualified Data.ByteString.Char8   as C8
import qualified Data.ByteString.Base16  as B16
import           Data.Default
import           Data.List
import qualified Data.Map.Strict         as M
import qualified Data.Set                as S
import qualified Data.Text               as T
import           Data.Aeson
import qualified GHC.Generics            as GHCG
import           Network.Socket.Internal

import           Blockchain.Data.Address
import           Blockchain.Data.RLP
import           Blockchain.ExtWord
import           Blockchain.Strato.Model.SHA


data IPAddress = IPv4 HostAddress deriving (Show, Read, Eq, Ord, GHCG.Generic, NFData, Binary)

instance RLPSerializable IPAddress where
  rlpEncode (IPv4 addy) = rlpEncode $ toInteger addy
  rlpDecode x = IPv4 (fromInteger $ rlpDecode x)

data Enode = Enode
  { pubKey     :: B.ByteString
  , ipAddress  :: IPAddress
  , tcpPort    :: Int
  , udpPort    :: Maybe Int
  } deriving (Show, Read, Eq, Ord, GHCG.Generic, NFData, Binary)

newtype ChainMembers = ChainMembers { unChainMembers :: M.Map Address Enode }
newtype ChainTxsInBlock = ChainTxsInBlock { unChainTxsInBlock :: M.Map Word256 [SHA] }
newtype IPChains = IPChains { unIPChains :: S.Set Word256 }

instance Default ChainMembers    where def = ChainMembers M.empty
instance Default ChainTxsInBlock where def = ChainTxsInBlock M.empty
instance Default IPChains        where def = IPChains S.empty

instance RLPSerializable Enode where
  rlpEncode (Enode pk ip tp up) =
    RLPArray [rlpEncode pk, rlpEncode ip, rlpEncode $ toInteger tp, rlpEncode (toInteger <$> up)]

  rlpDecode (RLPArray [a,b,c,d]) =
    Enode (rlpDecode a) (rlpDecode b) (fromInteger $ rlpDecode c) (fromInteger <$> (rlpDecode d))

  rlpDecode _ = error "error in rlpDecode for Enode type: bad RLPObject"

instance FromJSON Enode where
  parseJSON (String str) = return (readEnode $ T.unpack str)
  parseJSON x = error $ "could not parse JSON for Enode: " ++ show x

instance ToJSON Enode where
  toJSON enode = String (T.pack $ showEnode enode)


-- replacements for show/read for IPAddress and Enode, because implementing read is a nightmare
showIP :: IPAddress -> String
showIP (IPv4 addy) =
  let b3 = (addy `shiftR` 24) .&. 0xff
      b2 = (addy `shiftR` 16) .&. 0xff
      b1 = (addy `shiftR`  8) .&. 0xff
      b0 = addy .&. 0xff
  in concat . intersperse "." . map show $ [b3,b2,b1,b0]

readIP :: String -> IPAddress
readIP input =
  let (b3,temp) = break (=='.') input
      s0 = dropWhile (=='.') temp
      (b2, temp2) = break (=='.') s0
      s1 = dropWhile (=='.') temp2
      (b1, temp3) = break (=='.') s1
      b0 = dropWhile (=='.') temp3

      addy = ((read b0) + (((read b1) .&. 0xff) `shiftL` 8) + (((read b2) .&. 0xff) `shiftL` 16) +
        (((read b3) .&. 0xff) `shiftL` 24))
  in (IPv4 addy)

showEnode :: Enode -> String
showEnode (Enode pk ip tp up) =
    "enode://" ++
    (C8.unpack $ B16.encode pk) ++
    "@" ++
    (showIP ip) ++ ":" ++
    (show tp) ++ uPort
    where
      uPort =
        case up of
          Nothing -> ""
          Just x -> "?discport=" ++ show x

readEnode :: String -> Enode
readEnode input =
    let suffix = dropWhile (/='/') input
        pksuffix = dropWhile (=='/') suffix
        (pk, temp) = break (=='@') pksuffix
        ipsuffix = dropWhile (=='@') temp
        (ip, temp2) = break (==':') ipsuffix
        tcpsuffix = dropWhile (==':') temp2
        (tcp, temp3) = break (=='?') tcpsuffix
        udpsuffix = dropWhile (/='=') temp3
        udp = dropWhile (=='=') udpsuffix
        up =
          case udp of
            [] -> Nothing
            _ -> Just (read udp)
     in (Enode (fst $ B16.decode (C8.pack pk)) (readIP ip) (read tcp) up)
