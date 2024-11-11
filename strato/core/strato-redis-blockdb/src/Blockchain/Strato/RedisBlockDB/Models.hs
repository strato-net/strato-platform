{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeSynonymInstances #-}

{-# OPTIONS -fno-warn-redundant-constraints #-}
module Blockchain.Strato.RedisBlockDB.Models where

import BlockApps.X509.Certificate
import qualified Blockchain.Data.BlockHeader as BHD
import Blockchain.Data.ChainInfo
import Blockchain.Data.Enode
import Blockchain.Data.RLP
import qualified Blockchain.Data.Transaction as TXD
import Blockchain.Data.TransactionDef (formatChainId)
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Validator (Validator)
import Data.Binary
import qualified Data.ByteString.Base16 as SB16
import qualified Data.ByteString.Char8 as S8
import Data.ByteString.Lazy (fromStrict, toStrict)
import Data.List (intercalate)
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import Text.Format

data BlockDBNamespace
  = Headers
  | Transactions
  | Numbers
  | Uncles
  | Parent
  | Children
  | Canonical
  | PrivateChainInfo
  | PrivateChainMembers
  | PrivateTransactions
  | PrivateTxsInBlocks
  | PrivateOrgNameChains
  | Validators
  | PrivateTrueOrgNameChains
  | PrivateFalseOrgNameChains
  | X509Certificates
  | ParsedSetWhitePage
  | ParsedSetToX509
  deriving (Eq, Read, Show)

class RedisDBKeyable k where
  toKey :: k -> S8.ByteString

class RedisDBValuable v where
  toValue :: v -> S8.ByteString
  fromValue :: S8.ByteString -> v

instance RedisDBValuable Bool where
  toValue True = S8.singleton 't'
  toValue False = S8.empty
  fromValue = not . S8.null

instance RedisDBValuable Account where
  toValue = toStrict . encode
  fromValue = decode . fromStrict

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

instance RedisDBValuable S8.ByteString where
  toValue = SB16.encode
  fromValue x = case SB16.decode x of
    Right v -> v
    _ -> error "leftovers in base16 decode"

instance RedisDBKeyable Keccak256 where
  toKey = S8.pack . keccak256ToHex

instance RedisDBValuable ChainMemberParsedSet where
    toValue = toStrict . encode
    fromValue = decode . fromStrict

instance RedisDBKeyable ChainMemberParsedSet where
  toKey = toStrict . encode

instance RedisDBValuable Validator where
    toValue = toStrict . encode
    fromValue = decode . fromStrict

instance RedisDBKeyable Validator where
  toKey = toStrict . encode

instance RedisDBValuable Keccak256 where
  toValue = S8.pack . keccak256ToHex
  fromValue = keccak256FromHex . S8.unpack

instance RedisDBKeyable Address where
  toKey = toStrict . encode

instance RedisDBValuable Address where
  toValue = toKey
  fromValue = decode . fromStrict

instance RedisDBValuable X509CertInfoState where
  toValue = toStrict . encode
  fromValue = decode . fromStrict

instance RedisDBKeyable Word256 where
  toKey = word256ToBytes

instance RedisDBValuable RedisChainInfo where
  toValue = rlpSerialize . rlpEncode
  fromValue = rlpDecode . rlpDeserialize

instance RedisDBValuable RedisChainMemberRSet where
  toValue (RedisChainMemberRSet c) = toStrict $ encode c
  fromValue = RedisChainMemberRSet . decode . fromStrict

instance RedisDBValuable RedisOrgUnits where
  toValue = rlpSerialize . rlpEncode
  fromValue = rlpDecode . rlpDeserialize

instance RedisDBValuable RedisOrgUnitMembers where
  toValue = rlpSerialize . rlpEncode
  fromValue = rlpDecode . rlpDeserialize

instance RedisDBValuable RedisChainTxsInBlocks where
  toValue = rlpSerialize . rlpEncode
  fromValue = rlpDecode . rlpDeserialize

instance RedisDBKeyable IPAddress where
  toKey = S8.pack . showIP

instance RedisDBValuable RedisOrgNameChains where
  toValue = rlpSerialize . rlpEncode
  fromValue = rlpDecode . rlpDeserialize

instance RedisDBKeyable RedisValidator where
  toKey = rlpSerialize . rlpEncode

instance RedisDBKeyable Integer where
  toKey = S8.pack . show

instance RedisDBValuable Integer where
  fromValue v =
    case S8.readInt v of
      Just (num, _) -> toInteger num
      Nothing -> error "Invalid number format"

  toValue = S8.pack . show

instance RedisDBValuable RedisHeader where
  toValue = rlpSerialize . rlpEncode
  fromValue = RedisHeader . rlpDecode . rlpDeserialize

instance RedisDBValuable RedisTx where
  toValue = rlpSerialize . rlpEncode
  fromValue = rlpDecode . rlpDeserialize

instance (RLPSerializable a) => RedisDBValuable [a] where
  toValue = rlpSerialize . RLPArray . fmap rlpEncode

  -- (RLPArray elems)
  fromValue bytes =
    let elems = case rlpDeserialize bytes of
          (RLPArray elems') -> elems'
          _ -> error "fromValue: not an RLPArray"
     in rlpDecode <$> elems

instance (RLPSerializable a, RLPSerializable b) => RedisDBValuable (a, b) where
  toValue (a, b) = rlpSerialize $ RLPArray [rlpEncode a, rlpEncode b]

  -- fromValue bytes = let (RLPArray [a,b]) = rlpDeserialize bytes in (rlpDecode a, rlpDecode b)
  fromValue bytes =
    let elems = case rlpDeserialize bytes of
          (RLPArray elems') -> elems'
          _ -> error "fromValue: not an RLPArray"
     in case elems of
          [a, b] -> (rlpDecode a, rlpDecode b)
          _ -> error "fromValue: not a pair"

newtype RedisHeader = RedisHeader BHD.BlockHeader deriving newtype (Eq, Show, RLPSerializable, HasIstanbulExtra, BlockHeaderLike)

newtype RedisTx = RedisTx TXD.Transaction deriving newtype (Eq, Read, Show, RLPSerializable, TransactionLike)

newtype RedisTxs = RedisTxs [RedisTx] deriving newtype (Eq, Read, Show, RedisDBValuable)

newtype RedisUncles = RedisUncles [RedisHeader] deriving newtype (Eq, Show, RedisDBValuable)

newtype RedisChainInfo = RedisChainInfo ChainInfo deriving newtype (Eq, Show, RLPSerializable)

newtype RedisChainMemberRSet = RedisChainMemberRSet ChainMemberRSet deriving newtype (Eq, Show, RLPSerializable)

newtype RedisChainTxsInBlocks = RedisChainTxsInBlocks (M.Map Word256 [Keccak256]) deriving newtype (Eq, Show, RLPSerializable)

newtype RedisIPChains = RedisIPChains (S.Set Word256) deriving (Eq, Show)

newtype RedisOrgIdChains = RedisOrgIdChains (S.Set Word256) deriving (Eq, Show)

newtype RedisOrgNameChains = RedisOrgNameChains (S.Set Word256) deriving (Eq, Show)

newtype RedisOrgUnits = RedisOrgUnits [ChainMemberParsedSet] deriving (Eq, Show)

newtype RedisOrgUnitMembers = RedisOrgUnitMembers [ChainMemberParsedSet] deriving (Eq, Show)

newtype RedisValidator = RedisValidator ChainMemberParsedSet deriving (Eq, Show)

-- instance RLPSerializable RedisChainMemberRSet where
--   rlpEncode (RedisChainMemberRSet cmrs) = rlpEncode cmrs
--   rlpDecode = RedisChainMemberRSet . rlpDecode

instance RLPSerializable RedisIPChains where
  rlpEncode (RedisIPChains s) = rlpEncode $ S.toList s
  rlpDecode = RedisIPChains . S.fromList . rlpDecode

instance RLPSerializable RedisOrgIdChains where
  rlpEncode (RedisOrgIdChains s) = rlpEncode $ S.toList s
  rlpDecode = RedisOrgIdChains . S.fromList . rlpDecode

instance RLPSerializable RedisOrgNameChains where
  rlpEncode (RedisOrgNameChains s) = rlpEncode $ S.toList s
  rlpDecode = RedisOrgNameChains . S.fromList . rlpDecode

instance RLPSerializable RedisOrgUnits where
  rlpEncode (RedisOrgUnits s) = rlpEncode $ s
  rlpDecode = RedisOrgUnits . rlpDecode

instance RLPSerializable RedisOrgUnitMembers where
  rlpEncode (RedisOrgUnitMembers s) = rlpEncode $ s
  rlpDecode = RedisOrgUnitMembers . rlpDecode

instance RLPSerializable RedisValidator where
  rlpEncode (RedisValidator s) = rlpEncode s
  rlpDecode = RedisValidator . rlpDecode

data RedisBestBlock = RedisBestBlock
  { bestBlockHash :: Keccak256,
    bestBlockNumber :: Integer -- todo: BlockNumber
  }
  deriving (Eq, Read, Show)

instance RedisDBValuable RedisBestBlock where
  toValue = rlpSerialize . wrap
    where
      wrap (RedisBestBlock sha num) = RLPArray [rlpEncode sha, rlpEncode num]
  fromValue = unwrap . rlpDeserialize
    where
      unwrap (RLPArray [sha, num]) = RedisBestBlock (rlpDecode sha) (rlpDecode num)
      unwrap _ = error "we are clearly incapable of humane exception handling"

displayForNamespace :: BlockDBNamespace -> S8.ByteString -> String
displayForNamespace ns input = case ns of
  Numbers -> readSHA
  Children -> readSHA
  Canonical -> readSHA
  Parent -> readSHA
  Headers -> let RedisHeader hdr = fromValue input in format hdr
  Transactions -> let RedisTxs txs = fromValue input in intercalate "\n" [format tx | RedisTx tx <- txs]
  Uncles -> let RedisUncles us = fromValue input in show us
  PrivateChainInfo -> let RedisChainInfo info = fromValue input in show info
  PrivateChainMembers -> let RedisChainMemberRSet mems = fromValue input in show mems
  PrivateTransactions -> let (anchor, RedisTx tx) = fromValue input in formatChainId (Just anchor) ++ format tx
  PrivateTxsInBlocks -> let RedisChainTxsInBlocks ctibs = fromValue input in show ctibs
  PrivateOrgNameChains -> let RedisOrgNameChains oncs = fromValue input in format (S.toList oncs)
  PrivateTrueOrgNameChains -> let RedisOrgNameChains oncs = fromValue input in format (S.toList oncs)
  PrivateFalseOrgNameChains -> let RedisOrgNameChains oncs = fromValue input in format (S.toList oncs)
  Validators -> format (fromValue input :: S8.ByteString)
  X509Certificates -> format (fromValue input :: Address)
  ParsedSetWhitePage -> let RedisOrgUnits units = fromValue input in show units
  ParsedSetToX509 -> format input
  where
    readSHA = let x = fromValue input in format (keccak256ToWord256 x)
