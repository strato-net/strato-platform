{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
module Blockchain.Strato.Model.Address
    ( Address(..),
      prvKey2Address, pubKey2Address
    ) where

import qualified Crypto.Hash.SHA3                     as C
import           Data.Maybe                           (fromMaybe)

import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.ExtendedWord (Word160)
import           Blockchain.Strato.Model.Util

import           Data.Binary
import qualified Data.ByteString.Lazy                 as BL

import           Network.Haskoin.Crypto               hiding (Address, Word160)
import           Network.Haskoin.Internals            hiding (Address, Word160)

import           GHC.Generics


instance RLPSerializable Address where
  rlpEncode (Address a) = RLPString $ BL.toStrict $ encode a
  rlpDecode (RLPString s) = Address $ decode $ BL.fromStrict s
  rlpDecode x             = error ("Malformed rlp object sent to rlp2Address: " ++ show x)

newtype Address = Address Word160 deriving (Show, Eq, Read, Enum, Real, Bounded, Num, Ord, Generic, Integral)

prvKey2Address :: PrvKey -> Address
prvKey2Address prvKey =
  Address $ fromInteger $ byteString2Integer $ C.hash 256 $ BL.toStrict $ encode x `BL.append` encode y
  --B16.encode $ hash 256 $ BL.toStrict $ encode x `BL.append` encode y
  where
    point = pubKeyPoint $ derivePubKey prvKey
    x = fromMaybe (error "getX failed in prvKey2Address") $ getX point
    y = fromMaybe (error "getY failed in prvKey2Address") $ getY point

pubKey2Address :: PubKey -> Address
pubKey2Address pubKey =
  Address $ fromInteger $ byteString2Integer $ C.hash 256 $ BL.toStrict $ encode x `BL.append` encode y
  --B16.encode $ hash 256 $ BL.toStrict $ encode x `BL.append` encode y
  where
    x = fromMaybe (error "getX failed in prvKey2Address") $ getX point
    y = fromMaybe (error "getY failed in prvKey2Address") $ getY point
    point = pubKeyPoint pubKey
