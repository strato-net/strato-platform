{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric     #-}

module Blockchain.Data.Enode (
  Enode(..),
  ) where


import          Blockchain.Strato.Discovery.UDP
import          Blockchain.Data.RLP
import          Blockchain.ExtWord
import          Blockchain.Strato.Model.Address


data Enode = Enode 
  { pubKey     :: PubKey
  , ipAddress  :: IAddr
  , tcpPort    :: Int
  , udpPort    :: Maybe Int
  }

instance RLPSerializable Enode where
  rlpEncode (Enode pk ip tp up) = 
    RLPArray [rlpEncode pk, rlpEncode ip, rlpEncode tp, rlpEcnode up]

  rlpDecode (RLPArray [a,b,c,d]) = 
    Enode (rlpDecode a) (rlpDecode b) (rlpDecode c) (rlpDecode d)

  rlpDecode _ = error "error in rlpDecode for Enode type: bad RLPObject"


