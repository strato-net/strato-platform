{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# OPTIONS -fno-warn-orphans                                   #-}
module Executable.EVMCheckpoint where

import qualified Data.ByteString.Base16   as B16

import qualified Blockchain.Colors        as CL
import qualified Blockchain.Data.DataDefs as DD
import           Blockchain.Data.RLP
import           Blockchain.Format
import           Blockchain.SHA

import           Blockchain.VMContext     (ContextBestBlockInfo (..))
import qualified Network.Kafka.Protocol   as KP
import qualified Blockchain.MilenaTools   as KP

import           Control.Arrow            ((>>>))

data EVMCheckpoint = EVMCheckpoint {
    checkpointSHA    :: SHA,
    checkpointHead   :: DD.BlockData,
    ctxBestBlockInfo :: ContextBestBlockInfo
} deriving (Read, Show)

instance RLPSerializable EVMCheckpoint where
    rlpDecode (RLPArray [sha, header, bbi]) =
        EVMCheckpoint (rlpDecode sha) (rlpDecode header) (rlpDecode bbi)
    rlpDecode _ = error "unexpected RLP object"
    rlpEncode (EVMCheckpoint sha header bbi) =
        RLPArray [rlpEncode sha, rlpEncode header, rlpEncode bbi]

instance RLPSerializable ContextBestBlockInfo where
    rlpDecode (RLPArray [tag, body]) = case rlpDecode tag :: Integer of
        0 -> Unspecified
        1 -> case body of
            RLPArray [sha, header, tdiff, txCount, uncleCount] ->
                ContextBestBlockInfo (rlpDecode sha,
                                      rlpDecode header,
                                      rlpDecode tdiff,
                                      rlpDecodeInt txCount,
                                      rlpDecodeInt uncleCount
                                     )
                where rlpDecodeInt x = let y :: Integer = rlpDecode x in fromIntegral y
            x -> error $ "unexpected shape in rlpDecode ContextBestBlockInfo/body :: " ++ show x
        x -> error $ "Unexpected tag for ContextBestBlockInfo `" ++ show x ++ "`"
    rlpDecode x = error $ "unexpected shape in rlpDecode ContextBestBlockInfo :: " ++ show x
    rlpEncode input = case input of
        Unspecified -> RLPArray [rlpEncodeInt 0, RLPArray []]
        ContextBestBlockInfo (sha, header, tdiff, txCount, uncleCount) ->
            RLPArray [rlpEncodeInt 1,
                  RLPArray [rlpEncode sha, rlpEncode header, rlpEncode tdiff, rlpEncodeInt txCount, rlpEncodeInt uncleCount]]

        where rlpEncodeInt = (rlpEncode :: Integer -> RLPObject) . fromIntegral



instance Format EVMCheckpoint where -- todo add format instance for ContextBestBlockInfo and show it here as well.
    format (EVMCheckpoint sha _ _) =
        "EVMCheckpoint " ++ CL.red (short sha)
            where short = take 16 . formatSHAWithoutColor

toKafkaMetadata :: EVMCheckpoint -> KP.Metadata
toKafkaMetadata = KP.Metadata . KP.KString . B16.encode . rlpSerialize . rlpEncode

fromKafkaMetadata :: KP.Metadata -> EVMCheckpoint
fromKafkaMetadata = rlpDecode . rlpDeserialize . decode' . KP._kString . KP._kMetadata
    where decode' = B16.decode >>> \case
                        (result, "") -> result
                        _ -> error "Couldn't completely Base16 decode a string!"
