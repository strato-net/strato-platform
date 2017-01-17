{-# LANGUAGE OverloadedStrings #-}
module Executable.EVMCheckpoint where

import Blockchain.SHA
import Blockchain.Data.RLP
import qualified Blockchain.Data.DataDefs as DD
import Blockchain.Data.BlockDB (blockHeaderHash) -- for `instance RLPSerializable DD.BlockData` and blockHeaderHash
import Blockchain.Format

import Debug.Trace (trace)

import qualified Network.Kafka.Protocol as KP

data EVMCheckpoint = EVMCheckpoint {
    checkpointSHA  :: SHA,
    checkpointHead :: DD.BlockData
} | DummyEVMCP deriving (Read, Show)

instance RLPSerializable EVMCheckpoint where
    rlpDecode (RLPArray [sha, header]) = EVMCheckpoint (rlpDecode sha) (rlpDecode header)
    rlpEncode (EVMCheckpoint sha head) = RLPArray [rlpEncode sha, rlpEncode head]

instance Format EVMCheckpoint where
    format (EVMCheckpoint sha head) =
        "EVMCheckpoint {sha=" ++ format sha ++ ", hash=" ++ format (blockHeaderHash head) ++ "}"

toKafkaMetadata :: EVMCheckpoint -> KP.Metadata
toKafkaMetadata = KP.Metadata . KP.KString . rlpSerialize . rlpEncode

fromKafkaMetadata :: KP.Metadata -> EVMCheckpoint
fromKafkaMetadata (KP.Metadata (KP.KString s)) = trace (show s) $ rlpDecode (rlpDeserialize s)