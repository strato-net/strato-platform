{-# LANGUAGE OverloadedStrings #-}
module Executable.EVMCheckpoint where

import qualified Data.ByteString.Base16 as B16

import Blockchain.SHA
import Blockchain.Data.RLP
import qualified Blockchain.Data.DataDefs as DD
import Blockchain.Data.BlockDB (blockHeaderHash) -- for `instance RLPSerializable DD.BlockData` and blockHeaderHash
import Blockchain.Format
import qualified Blockchain.Colors as CL

import qualified Network.Kafka.Protocol as KP

data EVMCheckpoint = EVMCheckpoint {
    checkpointSHA  :: SHA,
    checkpointHead :: DD.BlockData
} deriving (Read, Show)

instance RLPSerializable EVMCheckpoint where
    rlpDecode (RLPArray [sha, header]) = EVMCheckpoint (rlpDecode sha) (rlpDecode header)
    rlpEncode (EVMCheckpoint sha head) = RLPArray [rlpEncode sha, rlpEncode head]

instance Format EVMCheckpoint where
    format (EVMCheckpoint sha head) =
        "EVMCheckpoint " ++ CL.red (short sha)
            where short = take 16 . formatSHAWithoutColor

toKafkaMetadata :: EVMCheckpoint -> KP.Metadata
toKafkaMetadata = KP.Metadata . KP.KString . B16.encode . rlpSerialize . rlpEncode

fromKafkaMetadata :: KP.Metadata -> EVMCheckpoint
fromKafkaMetadata = rlpDecode . rlpDeserialize . decode' . KP._kString . KP._kMetadata
    where decode' bs = case B16.decode bs of
                        (result, "") -> result
                        _ -> error "Couldn't completely Base16 decode a string!"