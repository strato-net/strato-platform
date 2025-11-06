{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}

module Blockchain.Strato.RedisBlockDB.Models (
  RedisDBValuable(..),
  RedisHeader(..),
  RedisUncles(..),
  RedisTx,
  RedisTxs(..),
  BlockDBNamespace(..),
  RedisDBKeyable(..),
  displayForNamespace
  ) where

import qualified Blockchain.Data.BlockHeader as BHD
import Blockchain.Data.Enode
import Blockchain.Data.RLP
import qualified Blockchain.Data.Transaction as TXD
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Validator (Validator)
import Data.Binary
import qualified Data.ByteString.Base16 as SB16
import qualified Data.ByteString.Char8 as S8
import Data.ByteString.Lazy (toStrict)
import Data.List (intercalate)
import Text.Format

data BlockDBNamespace
  = Headers
  | Transactions
  | Numbers
  | Uncles
  | Parent
  | Children
  | Canonical
  | Validators
  deriving (Eq, Read, Show)

class RedisDBKeyable k where
  toKey :: k -> S8.ByteString

class RedisDBValuable v where
  toValue :: v -> S8.ByteString
  fromValue :: S8.ByteString -> v

instance RLPSerializable a => RedisDBValuable a where
  toValue = rlpSerialize . rlpEncode
  fromValue = rlpDecode . rlpDeserialize

instance RedisDBKeyable S8.ByteString where
  toKey = SB16.encode

instance RedisDBKeyable (String, Maybe String, Maybe String) where
  toKey (n, u, c) = SB16.encode . S8.pack $ (n ++ maybeSnd ++ maybeThrd)
    where
      maybeSnd = case u of
        Nothing -> "/"
        Just a -> "/" ++ a
      maybeThrd = case c of
        Nothing -> ""
        Just a -> "/" ++ a

instance RedisDBKeyable Keccak256 where
  toKey = S8.pack . keccak256ToHex

instance RedisDBKeyable Validator where
  toKey = toStrict . encode

instance RedisDBKeyable Address where
  toKey = toStrict . encode

instance RedisDBKeyable Word256 where
  toKey = word256ToBytes

instance RedisDBKeyable IPAddress where
  toKey = S8.pack . showIP

instance RedisDBKeyable Integer where
  toKey = S8.pack . show

newtype RedisHeader = RedisHeader BHD.BlockHeader deriving newtype (Eq, Show, RLPSerializable, HasIstanbulExtra, BlockHeaderLike)

newtype RedisTx = RedisTx TXD.Transaction deriving newtype (Eq, Read, Show, RLPSerializable, TransactionLike)

newtype RedisTxs = RedisTxs [RedisTx] deriving newtype (Eq, Read, Show, RLPSerializable)

newtype RedisUncles = RedisUncles [RedisHeader] deriving newtype (Eq, Show, RLPSerializable)

displayForNamespace :: BlockDBNamespace -> S8.ByteString -> String
displayForNamespace ns input = case ns of
  Numbers -> readSHA
  Children -> readSHA
  Canonical -> readSHA
  Parent -> readSHA
  Headers -> let RedisHeader hdr = fromValue input in format hdr
  Transactions -> let RedisTxs txs = fromValue input in intercalate "\n" [format tx | RedisTx tx <- txs]
  Uncles -> let RedisUncles us = fromValue input in show us
  Validators -> format (fromValue input :: S8.ByteString)
  where
    readSHA = let x = fromValue input in format (keccak256ToWord256 x)
