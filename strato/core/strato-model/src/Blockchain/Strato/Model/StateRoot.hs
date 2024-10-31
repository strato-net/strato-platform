{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Strato.Model.StateRoot
  ( StateRoot (..),
    emptyTriePtr,
    sha2StateRoot,
    unboxStateRoot,
  )
where

import Blockchain.Data.RLP
import Blockchain.MiscJSON ()
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Control.Monad
import Data.Aeson
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.ByteString.Arbitrary
import qualified Data.ByteString.Char8 as BC
import Data.Data
import Data.Default
import Data.String
import GHC.Generics
import Test.QuickCheck
import qualified Text.Colors as CL
import Text.Format

-- | Internal nodes are indexed in the underlying database by their keccak256-bit hash.
-- This types represents said hash.
--
-- The stateRoot is of this type,
-- (ie- the pointer to the full set of key/value pairs at a particular time in history), and
-- will be of interest if you need to refer to older or parallel version of the data.
newtype StateRoot = StateRoot B.ByteString
  deriving (Show, Eq, Ord, Read, Generic, Data)
  deriving newtype (IsString)

instance Format StateRoot where
  format x | x == emptyTriePtr = CL.yellow "<empty>"
  format (StateRoot x) = CL.yellow $ BC.unpack $ B16.encode x

instance NFData StateRoot

instance FromJSON StateRoot

instance ToJSON StateRoot

instance Binary StateRoot where
  put (StateRoot x) = sequence_ $ put <$> B.unpack x
  get = StateRoot <$> B.pack <$> replicateM 32 get

instance RLPSerializable StateRoot where
  rlpEncode (StateRoot x) = rlpEncode x
  rlpDecode x = StateRoot $ rlpDecode x

instance Default StateRoot where
  def = emptyTriePtr

-- | The stateRoot of the empty database.
emptyTriePtr :: StateRoot
emptyTriePtr = StateRoot $ keccak256ToByteString $ hash $ rlpSerialize $ rlpEncode (0 :: Integer)

sha2StateRoot :: Keccak256 -> StateRoot
sha2StateRoot x = StateRoot $ keccak256ToByteString x

unboxStateRoot :: StateRoot -> B.ByteString
unboxStateRoot (StateRoot b) = b

instance Arbitrary StateRoot where
  arbitrary = StateRoot <$> fastRandBs 32
