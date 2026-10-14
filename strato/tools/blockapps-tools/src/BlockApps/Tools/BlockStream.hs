{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.BlockStream (exportBlocks, verifyBlocks) where

import Blockchain.BlockDB (getCanonicalHeader)
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader (headerHash, number, parentHash)
import Blockchain.Data.RLP
import Blockchain.EthConf (lookupRedisBlockDBConfig)
import Blockchain.Model.SyncState (bestBlockNumber)
import Blockchain.Strato.Model.Keccak256 (Keccak256, keccak256ToHex)
import Blockchain.Strato.RedisBlockDB.Models (fromValue, toKey)
import Blockchain.SyncDB (getBestBlockInfo)
import Control.DeepSeq (force)
import Control.Exception (evaluate, onException)
import Control.Monad (unless, when)
import Data.Binary.Get (getWord64be, runGet)
import Data.Binary.Put (putWord64be, runPut)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.Word (Word64)
import qualified Database.Redis as Redis
import System.Directory (doesPathExist, removeFile, renameFile)
import System.IO

-- Version 1: magic, final block number (uint64 big endian), then blocks 0..final.
-- Each block is its complete wire RLP, preceded by a uint64 big endian byte length.
magic :: BS.ByteString
magic = "STRATO-BLOCKS-1\n"

exportBlocks :: FilePath -> Maybe Integer -> IO ()
exportBlocks path requestedEnd = do
  let partial = path ++ ".partial"
  mapM_ (\p -> doesPathExist p >>= \exists -> when exists $ fail $ "File already exists: " ++ p) [path, partial]
  conn <- Redis.checkedConnect lookupRedisBlockDBConfig
  best <- Redis.runRedis conn getBestBlockInfo >>= maybe (fail "No indexed best block") pure
  let end = maybe (bestBlockNumber best) id requestedEnd
  unless (end >= 0 && end <= bestBlockNumber best && end <= toInteger (maxBound :: Word64)) $
    fail "Requested end block is outside the indexed chain"
  anchor <- Redis.runRedis conn (getCanonicalHeader end) >>= maybe (fail "Missing final canonical header") pure
  withBinaryFile partial WriteMode (\handle -> do
    BS.hPut handle magic
    putWord handle $ fromInteger end
    let loop start previous !txCount
          | start > end = do
              final <- Redis.runRedis conn (getCanonicalHeader end)
              unless (fmap headerHash final == Just (headerHash anchor) && previous == Just (headerHash anchor)) $
                fail "Canonical chain changed during export"
              report (end + 1) txCount previous
          | otherwise = do
              let heights = [start .. min end (start + 999)]
              canonical <- fetch conn $ map (("q:" <>) . toKey) heights
              let hashes = map fromValue canonical :: [Keccak256]
              bodies <- fetch conn [prefix <> toKey hash | hash <- hashes, prefix <- ["h:", "t:", "u:"]]
              (lastHash, total) <- writeBatch handle previous txCount $ zip3 heights hashes (triples bodies)
              hPutStrLn stderr $ "Exported through block " ++ show (last heights)
              loop (last heights + 1) lastHash total
    loop 0 Nothing 0) `onException` removeFile partial
  renameFile partial path
  where
    fetch conn keys = Redis.runRedis conn (Redis.mget keys) >>= either (fail . show) (mapM require . zip keys)
    require (key, value) = maybe (fail $ "Missing Redis key: " ++ BC.unpack key) pure value
    triples (h:t:u:rest) = (h,t,u) : triples rest
    triples [] = []
    triples _ = error "Incomplete Redis block batch"
    writeBatch _ previous count [] = pure (previous, count)
    writeBatch handle previous !count ((height, hash, (h,t,u)):rest) = do
      let bytes = rlpSerialize $ RLPArray $ map rlpDeserialize [h,t,u]
      block <- decodeBlock bytes
      next <- checkBlock height previous block
      unless (next == hash) $ fail $ "Canonical hash mismatch at block " ++ show height
      putWord handle $ fromIntegral $ BS.length bytes
      BS.hPut handle bytes
      writeBatch handle (Just next) (count + toInteger (length $ blockReceiptTransactions block)) rest

verifyBlocks :: FilePath -> IO ()
verifyBlocks path = withBinaryFile path ReadMode $ \handle -> do
  signature <- exact handle $ BS.length magic
  unless (signature == magic) $ fail "Unrecognized block stream format"
  end <- toInteger <$> word handle
  let loop height previous !count
        | height > end = do
            eof <- hIsEOF handle
            unless eof $ fail "Trailing data after final block"
            report height count previous
        | otherwise = do
            size <- word handle
            unless (size > 0 && toInteger size <= toInteger (maxBound :: Int)) $ fail "Invalid block frame length"
            bytes <- exact handle $ fromIntegral size
            block <- decodeBlock bytes
            unless (rlpSerialize (rlpEncode block) == bytes) $ fail $ "Noncanonical block encoding at " ++ show height
            next <- checkBlock height previous block
            loop (height + 1) (Just next) (count + toInteger (length $ blockReceiptTransactions block))
  loop 0 Nothing 0

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

report :: Integer -> Integer -> Maybe Keccak256 -> IO ()
report count transactions final = do
  putStrLn $ "Blocks: " ++ show count ++ " (0.." ++ show (count - 1) ++ ")"
  putStrLn $ "Transactions: " ++ show transactions
  putStrLn $ "Final hash: " ++ maybe "none" keccak256ToHex final
