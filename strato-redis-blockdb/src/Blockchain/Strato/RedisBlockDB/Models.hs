module Blockchain.Strato.RedisBlockDB.Models where

data BlockDBNamespace = Headers | Transactions | Numbers | Uncles
    deriving (Eq, Read, Show)

data RedisHeader = RedisHeader {
                 } deriving (Eq, Read, Show)

data RedisTx = RedisTx {
             } deriving (Eq, Read, Show)

newtype RedisTxs = RedisTxs [RedisTx]
    deriving (Eq, Read, Show)

newtype RedisUncles = RedisUncles [RedisHeader]
    deriving (Eq, Read, Show)

