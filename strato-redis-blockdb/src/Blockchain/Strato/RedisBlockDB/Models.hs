{-# LANGUAGE GeneralizedNewtypeDeriving, DeriveGeneric #-}
module Blockchain.Strato.RedisBlockDB.Models where

import qualified Data.Binary as Binary

import           Blockchain.Strato.Model.Class
import           Blockchain.Data.RLP

import GHC.Generics

data BlockDBNamespace = Headers | Transactions | Numbers | Uncles
    deriving (Eq, Read, Show)

data RedisHeader = RedisHeader {
                 } deriving (Eq, Read, Show, Generic)

data RedisTx = RedisTx {
             } deriving (Eq, Read, Show, Generic)

newtype RedisTxs = RedisTxs [RedisTx]
    deriving (Eq, Read, Show, Binary.Binary, Generic)

newtype RedisUncles = RedisUncles [RedisHeader]
    deriving (Eq, Read, Show, Binary.Binary, Generic)

instance RLPSerializable RedisTx
instance RLPSerializable RedisHeader

instance TransactionLike RedisTx
instance BlockHeaderLike RedisHeader

instance Binary.Binary RedisTx
instance Binary.Binary RedisHeader