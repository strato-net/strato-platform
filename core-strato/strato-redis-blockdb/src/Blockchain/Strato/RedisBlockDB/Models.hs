{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE TypeSynonymInstances       #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
module Blockchain.Strato.RedisBlockDB.Models where

import qualified Data.ByteString.Base16        as SB16
import qualified Data.ByteString.Char8         as S8
import           Data.List                     (intercalate)
import qualified Data.Map.Strict               as M
import qualified Data.Set                      as S

import qualified Blockchain.Data.BlockHeader   as BHD
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Enode
import           Blockchain.Data.RLP
import qualified Blockchain.Data.Transaction   as TXD
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.SHA
import           Text.Format

data BlockDBNamespace = Headers
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
                      | PrivateIPChains
    deriving (Eq, Read, Show)

class RedisDBKeyable k where
    toKey :: k -> S8.ByteString

class RedisDBValuable v where
    toValue   :: v -> S8.ByteString
    fromValue :: S8.ByteString -> v

instance RedisDBKeyable S8.ByteString where
    toKey = SB16.encode

instance RedisDBValuable S8.ByteString where
    toValue   = SB16.encode
    fromValue x = case SB16.decode x of
        (v, "") -> v
        _       -> error "leftovers in base16 decode"

instance RedisDBKeyable SHA where
    toKey = S8.pack . shaToHex

instance RedisDBValuable SHA where
    toValue   = S8.pack . shaToHex
    fromValue = shaFromHex . S8.unpack

instance RedisDBKeyable Word256 where
    toKey = word256ToBytes

instance RedisDBValuable RedisChainInfo where
    toValue   = rlpSerialize . rlpEncode
    fromValue = rlpDecode . rlpDeserialize

instance RedisDBValuable RedisChainMembers where
    toValue   = rlpSerialize . rlpEncode
    fromValue = rlpDecode . rlpDeserialize

instance RedisDBValuable RedisChainTxsInBlocks where
    toValue   = rlpSerialize . rlpEncode
    fromValue = rlpDecode . rlpDeserialize

instance RedisDBKeyable IPAddress where
    toKey = S8.pack . showIP

instance RedisDBValuable RedisIPChains where
    toValue   = rlpSerialize . rlpEncode
    fromValue = rlpDecode . rlpDeserialize

instance RedisDBKeyable Integer where
    toKey = S8.pack . show

instance RedisDBValuable RedisHeader where
    toValue   = rlpSerialize . rlpEncode
    fromValue = RedisHeader . rlpDecode . rlpDeserialize

instance RedisDBValuable RedisTx where
    toValue   = rlpSerialize . rlpEncode
    fromValue = rlpDecode . rlpDeserialize

instance (RLPSerializable a) => RedisDBValuable [a] where
    toValue         = rlpSerialize . RLPArray . fmap rlpEncode
    fromValue bytes = let (RLPArray elems) = rlpDeserialize bytes in rlpDecode <$> elems

newtype RedisHeader    = RedisHeader   BHD.BlockHeader deriving newtype (Eq, Read, Show, RLPSerializable, BlockHeaderLike)
newtype RedisTx        = RedisTx       TXD.Transaction deriving newtype (Eq, Read, Show, RLPSerializable, TransactionLike)
newtype RedisTxs       = RedisTxs      [RedisTx]       deriving newtype (Eq, Read, Show, RedisDBValuable)
newtype RedisUncles    = RedisUncles   [RedisHeader]   deriving newtype (Eq, Read, Show, RedisDBValuable)
newtype RedisChainInfo = RedisChainInfo ChainInfo      deriving newtype (Eq, Show, RLPSerializable)
newtype RedisChainMembers = RedisChainMembers (M.Map Address Enode) deriving newtype (Eq, Show, RLPSerializable)
newtype RedisChainTxsInBlocks = RedisChainTxsInBlocks (M.Map Word256 [SHA]) deriving newtype (Eq, Show, RLPSerializable)
newtype RedisIPChains = RedisIPChains (S.Set Word256) deriving (Eq, Show)

instance RLPSerializable RedisIPChains where
  rlpEncode (RedisIPChains s) = rlpEncode $ S.toList s
  rlpDecode = RedisIPChains . S.fromList . rlpDecode

data RedisBestBlock = RedisBestBlock { bestBlockHash            :: SHA
                                     , bestBlockNumber          :: Integer          -- todo: BlockNumber
                                     , bestBlockTotalDifficulty :: Integer -- todo: TotalDifficulty
                                     } deriving (Eq, Read, Show)

instance RedisDBValuable RedisBestBlock where
    toValue = rlpSerialize . wrap
        where wrap (RedisBestBlock sha num total) = RLPArray [rlpEncode sha, rlpEncode num, rlpEncode total]
    fromValue = unwrap . rlpDeserialize
        where unwrap (RLPArray [sha, num, total]) = RedisBestBlock (rlpDecode sha) (rlpDecode num) (rlpDecode total)
              unwrap _                            = error "we are clearly incapable of humane exception handling"

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
    PrivateChainMembers -> let RedisChainMembers mems = fromValue input in show mems
    PrivateTransactions -> let RedisTx tx = fromValue input in format tx
    PrivateTxsInBlocks -> let RedisChainTxsInBlocks ctibs = fromValue input in show ctibs
    PrivateIPChains -> let RedisIPChains ipcs = fromValue input in format (S.toList ipcs)
  where
    readSHA = let SHA x = fromValue input in format x
