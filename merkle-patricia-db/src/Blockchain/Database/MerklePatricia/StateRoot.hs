{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}

module Blockchain.Database.MerklePatricia.StateRoot (
  StateRoot(..),
  emptyTriePtr,
  sha2StateRoot,
  unboxStateRoot
  ) where

import Control.Monad
import qualified Crypto.Hash.SHA3 as C
import Data.Aeson
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.String

import qualified Blockchain.Colors as CL
import Blockchain.Data.RLP
import Blockchain.ExtWord
import Blockchain.Format
import Blockchain.MiscJSON ()
import Blockchain.SHA

import GHC.Generics

-- | Internal nodes are indexed in the underlying database by their 256-bit SHA3 hash.
-- This types represents said hash.
--
-- The stateRoot is of this type, 
-- (ie- the pointer to the full set of key/value pairs at a particular time in history), and
-- will be of interest if you need to refer to older or parallel version of the data.

newtype StateRoot = StateRoot B.ByteString deriving (Show, Eq, Read, Generic, IsString)

instance Format StateRoot where
  format x | x == emptyTriePtr = CL.yellow "<empty>"
  format (StateRoot x) = CL.yellow $ BC.unpack $ B16.encode x

instance FromJSON StateRoot
instance ToJSON StateRoot
  
instance Binary StateRoot where
  put (StateRoot x) = sequence_ $ put <$> B.unpack x
  get = StateRoot <$> B.pack <$> replicateM 32 get

instance RLPSerializable StateRoot where
    rlpEncode (StateRoot x) = rlpEncode x
    rlpDecode x = StateRoot $ rlpDecode x

-- | The stateRoot of the empty database.
emptyTriePtr::StateRoot
emptyTriePtr = StateRoot $ C.hash 256 $ rlpSerialize $ rlpEncode (0::Integer)

sha2StateRoot::SHA->StateRoot
sha2StateRoot (SHA x) = StateRoot $ B.pack $ word256ToBytes x

unboxStateRoot :: StateRoot -> B.ByteString
unboxStateRoot (StateRoot b) = b
