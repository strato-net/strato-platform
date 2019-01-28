{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE TypeSynonymInstances       #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
module Blockchain.Strato.RedisBlockDB.Models where

import qualified Data.ByteString.Base16        as SB16
import qualified Data.ByteString.Char8         as S8
import qualified Data.Map.Strict               as M

import qualified Blockchain.Data.BlockHeader   as BHD
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Enode
import           Blockchain.Data.RLP
import qualified Blockchain.Data.Transaction   as TXD
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.SHA

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
    toKey = fastWord256ToBytes

instance RedisDBValuable RedisChainInfo where
    toValue   = rlpSerialize . rlpEncode
    fromValue = rlpDecode . rlpDeserialize

instance RedisDBValuable RedisChainMembers where
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

newtype RedisHeader    = RedisHeader   BHD.BlockHeader deriving (Eq, Read, Show, RLPSerializable, BlockHeaderLike)
newtype RedisTx        = RedisTx       TXD.Transaction deriving (Eq, Read, Show, RLPSerializable, TransactionLike)
newtype RedisTxs       = RedisTxs      [RedisTx]       deriving (Eq, Read, Show, RedisDBValuable)
newtype RedisUncles    = RedisUncles   [RedisHeader]   deriving (Eq, Read, Show, RedisDBValuable)
newtype RedisChainInfo = RedisChainInfo ChainInfo      deriving (Eq, Show, RLPSerializable)
newtype RedisChainMembers = RedisChainMembers (M.Map Address Enode) deriving (Eq, Show, RLPSerializable)
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
