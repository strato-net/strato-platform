{-# LANGUAGE OverloadedStrings, LambdaCase #-}
module Executable.EVMCheckpoint where

import qualified Data.ByteString.Base16 as B16

import Blockchain.SHA
import Blockchain.Data.RLP
import qualified Blockchain.Data.DataDefs as DD
import Blockchain.Data.BlockDB (blockHeaderHash) -- for `instance RLPSerializable DD.BlockData` and blockHeaderHash
import Blockchain.Format
import qualified Blockchain.Colors as CL

import qualified Network.Kafka.Protocol as KP

import Control.Arrow ((>>>))

data EVMCheckpoint = EVMCheckpoint {
    checkpointSHA  :: SHA,
    checkpointHead :: DD.BlockData,
    checkpointTXs  :: [SHA]
} deriving (Read, Show)

instance RLPSerializable EVMCheckpoint where
    rlpDecode (RLPArray [sha, header, RLPArray txShas]) =
        EVMCheckpoint (rlpDecode sha) (rlpDecode header) (rlpDecode <$> txShas)
    rlpEncode (EVMCheckpoint sha head txShas) =
        RLPArray [rlpEncode sha, rlpEncode head, RLPArray (rlpEncode <$> txShas)]

instance Format EVMCheckpoint where
    format (EVMCheckpoint sha head txhs) =
        "EVMCheckpoint " ++ CL.red (short sha) ++ (' ':count)
            where short = take 16 . formatSHAWithoutColor
                  count = CL.green $ show (length txhs)

toKafkaMetadata :: EVMCheckpoint -> KP.Metadata
toKafkaMetadata = KP.Metadata . KP.KString . B16.encode . rlpSerialize . rlpEncode

fromKafkaMetadata :: KP.Metadata -> EVMCheckpoint
fromKafkaMetadata = rlpDecode . rlpDeserialize . decode' . KP._kString . KP._kMetadata
    where decode' = B16.decode >>> \case
                        (result, "") -> result
                        _ -> error "Couldn't completely Base16 decode a string!"