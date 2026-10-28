{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.BlockStream (exportBlocks, verifyBlocks) where

import Blockchain.BlockDB (getCanonicalHeader)
import Blockchain.Data.Block
import Blockchain.BlockStream (withBlockStream, checkBlock, decodeBlock, magic, putWord)
import Blockchain.Data.BlockHeader (headerHash)
import Blockchain.Data.RLP
import Blockchain.EthConf (lookupRedisBlockDBConfig)
import Blockchain.Model.SyncState (bestBlockNumber)
import Blockchain.Strato.Model.Keccak256 (Keccak256, keccak256ToHex)
import Blockchain.Strato.RedisBlockDB.Models (fromValue, toKey)
import Blockchain.SyncDB (getBestBlockInfo)
import Control.Exception (onException)
import Control.Monad (unless, when)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Char8 as BC
import Data.Word (Word64)
import qualified Database.Redis as Redis
import System.Directory (doesPathExist, removeFile, renameFile)
import System.IO

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
verifyBlocks path = withBlockStream path $ \_ next -> do
  let loop !count !transactions previous = next >>= maybe
        (report count transactions previous)
        (\block -> loop (count + 1)
          (transactions + toInteger (length $ blockReceiptTransactions block))
          (Just $ headerHash $ blockBlockData block))
  loop 0 0 Nothing

report :: Integer -> Integer -> Maybe Keccak256 -> IO ()
report count transactions final = do
  putStrLn $ "Blocks: " ++ show count ++ " (0.." ++ show (count - 1) ++ ")"
  putStrLn $ "Transactions: " ++ show transactions
  putStrLn $ "Final hash: " ++ maybe "none" keccak256ToHex final
