{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}

module Blockchain.Data.Enode (
  Enode(..),
  ) where


import          Crypto.Types.PubKey.ECC
import          Network.Socket.Internal
import          Network.Haskoin.Crypto
--import          Network.Haskoin.Internals

import          Blockchain.Data.RLP
import          Blockchain.Data.PubKey
-- import          Blockchain.ExtWord
-- import          Blockchain.Strato.Model.Address


data IPAddress = IPv4 HostAddress | IPv6 HostAddress6

data Enode = Enode 
  { pubKey     :: PubKey
  , ipAddress  :: IPAddress
  , tcpPort    :: Int
  , udpPort    :: Maybe Int
  }


trd :: (a,a,a,a) -> a
trd (_,_,x,_) = x

fth :: (a,a,a,a) -> a
fth (_,_,_,x) = x


instance RLPSerializable PubKey where
  rlpEncode pk = RLPArray [rlpEncode $ pubKeyPoint pk, rlpEncode $ pubKeyCompressed pk]
  rlpDecode _ = error "error in rlpDecode for PubKey: bad RLPObject"
--  rlpDecode (RLPArray [a,b]) = PubKey (rlpDecode a) (rlpDecode b)


instance RLPSerializable IPAddress where
  rlpEncode (IPv4 addy) = RLPArray [rlpEncode (0::Integer), rlpEncode addy]
  rlpEncode (IPv6 addy) = RLPArray [rlpEncode (1::Integer), rlpEncode addy]
  rlpDecode (RLPArray (x:xs))
    | (rlpDecode x) == (0::Integer) = IPv4 $ rlpDecode xs
    | (rlpDecode x) == (1::Integer) = IPv6 $ rlpDecode xs
  
  rlpDecode _ = error "error in rlpDecode for IPAddress: bad RLPObject"

instance RLPSerializable Enode where
  rlpEncode (Enode pk ip tp up) = 
    RLPArray [rlpEncode pk, rlpEncode ip, rlpEncode tp, rlpEcnode up]

  rlpDecode (RLPArray [a,b,c,d]) = 
    Enode (rlpDecode a) (rlpDecode b) (rlpDecode c) (rlpDecode d)

  rlpDecode _ = error "error in rlpDecode for Enode type: bad RLPObject"


