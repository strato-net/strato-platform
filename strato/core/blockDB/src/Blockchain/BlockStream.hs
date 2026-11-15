{-# LANGUAGE OverloadedStrings #-}

module Blockchain.BlockStream (withBlockStream, checkBlock, decodeBlock, magic, putWord) where

import Blockchain.Data.Block
import Blockchain.Data.BlockHeader (headerHash, number, parentHash)
import Blockchain.Data.RLP
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Control.DeepSeq (force)
import Control.Exception (evaluate)
import Control.Monad (unless)
import Data.Binary.Get (getWord64be, runGet)
import Data.Binary.Put (putWord64be, runPut)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as BL
import Data.IORef
import Data.Word (Word64)
import System.IO

-- Version 1: magic, final block number (uint64 big endian), then blocks 0..final.
-- Each block is its complete wire RLP, preceded by a uint64 big endian byte length.
magic :: BS.ByteString
magic = "STRATO-BLOCKS-1\n"

withBlockStream :: FilePath -> (Integer -> IO (Maybe Block) -> IO a) -> IO a
withBlockStream path action = withBinaryFile path ReadMode $ \handle -> do
  signature <- exact handle $ BS.length magic
  unless (signature == magic) $ fail "Unrecognized block stream format"
  end <- toInteger <$> word handle
  position <- newIORef (0, Nothing)
  let next = do
        (height, previous) <- readIORef position
        if height > end
          then do
            eof <- hIsEOF handle
            unless eof $ fail "Trailing data after final block"
            pure Nothing
          else do
            size <- word handle
            unless (size > 0 && toInteger size <= toInteger (maxBound :: Int)) $ fail "Invalid block frame length"
            bytes <- exact handle $ fromIntegral size
            block <- decodeBlock bytes
            unless (rlpSerialize (rlpEncode block) == bytes) $ fail $ "Noncanonical block encoding at " ++ show height
            hash <- checkBlock height previous block
            writeIORef position (height + 1, Just hash)
            pure $ Just block
  action end next

decodeBlock :: BS.ByteString -> IO Block
decodeBlock = evaluate . force . rlpDecode . rlpDeserialize

checkBlock :: Integer -> Maybe Keccak256 -> Block -> IO Keccak256
checkBlock height previous block = do
  let header = blockBlockData block
  unless (number header == height) $ fail $ "Unexpected block number; expected " ++ show height
  unless (maybe True (== parentHash header) previous) $ fail $ "Parent hash mismatch at block " ++ show height
  pure $ headerHash header

putWord :: Handle -> Word64 -> IO ()
putWord handle = BL.hPut handle . runPut . putWord64be

word :: Handle -> IO Word64
word handle = runGet getWord64be . BL.fromStrict <$> exact handle 8

exact :: Handle -> Int -> IO BS.ByteString
exact handle size = do
  remaining <- (-) <$> hFileSize handle <*> hTell handle
  unless (toInteger size <= remaining) $ fail "Truncated block stream"
  bytes <- BS.hGet handle size
  unless (BS.length bytes == size) $ fail "Truncated block stream"
  pure bytes
