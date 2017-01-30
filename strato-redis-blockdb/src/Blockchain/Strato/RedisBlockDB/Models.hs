{-# LANGUAGE GeneralizedNewtypeDeriving #-}
module Blockchain.Strato.RedisBlockDB.Models where

import qualified Data.Serialize                as Serialize
import qualified Data.Serialize.Get            as Get
import qualified Data.Serialize.Put            as Put

import qualified Data.ByteString.Char8         as S8

import           Blockchain.Strato.Model.Class
import           Blockchain.Data.RLP
import qualified Blockchain.Data.BlockHeader   as BHD
import qualified Blockchain.Data.Transaction   as TXD

data BlockDBNamespace = Headers | Transactions | Numbers | Uncles | Body
    deriving (Eq, Read, Show)

newtype RedisHeader = RedisHeader BHD.BlockHeader deriving (Eq, Read, Show, RLPSerializable, BlockHeaderLike)
newtype RedisTx     = RedisTx     TXD.Transaction deriving (Eq, Read, Show, RLPSerializable, TransactionLike)

newtype RedisTxs = RedisTxs [RedisTx]
    deriving (Eq, Read, Show, Serialize.Serialize)

newtype RedisUncles = RedisUncles [RedisHeader]
    deriving (Eq, Read, Show, Serialize.Serialize)

instance Serialize.Serialize RedisTx where
    put (RedisTx t) = do
        let serialized = rlpSerialize (rlpEncode t)
            len        = S8.length serialized
        Put.putWord64be (fromIntegral len)
        Put.putByteString serialized
    get = do
        size <- fromIntegral <$> Get.getWord64be
        dat  <- Get.getByteString size
        return . RedisTx $ rlpDecode (rlpDeserialize dat)

instance Serialize.Serialize RedisHeader where
    put (RedisHeader h) = do
        let serialized = rlpSerialize (rlpEncode h)
            len        = S8.length serialized
        Put.putWord64be (fromIntegral len)
        Put.putByteString serialized
    get = do
        size <- fromIntegral <$> Get.getWord64be
        dat  <- Get.getByteString size
        return . RedisHeader $ rlpDecode (rlpDeserialize dat)
