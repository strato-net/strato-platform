{-# LANGUAGE OverloadedStrings, ScopedTypeVariables #-}
module BlockApps.Tools.SyncStats where

import Blockchain.EthConf (apiConfig, apiListenAddress, ethConf, lookupRedisBlockDBConfig)
import Blockchain.Model.SyncState
import Blockchain.SyncDB
import Control.Exception (SomeException, try)
import qualified Data.ByteString.Lazy.Char8 as BL
import Database.Redis
import Network.HTTP.Client (defaultManagerSettings, httpLbs, newManager, parseRequest, responseBody)
import Text.Format
import Text.Printf (printf)
import Text.Read (readMaybe)

syncStats :: IO ()
syncStats = do
  conn <- checkedConnect lookupRedisBlockDBConfig

  bestBlock <- runRedis conn getBestBlockInfo
  bestSequencedBlock <- runRedis conn getBestSequencedBlockInfo
  worldsBestBlock <- runRedis conn getWorldBestBlockInfo
  vmBest <- vmBestBlock
  cirrusBest <- runRedis conn getCirrusBestBlockNumber
  syncStatus <- runRedis conn getSyncStatus
  syncStatusNow <- runRedis conn getSyncStatusNow

  -- One line per stage of the pipeline, in pipeline order. Each stage writes
  -- its own Redis key, so these can legitimately differ while the node is
  -- catching up; the gaps between them show where the backlog is.
  putStrLn "Block Positions:"
  putStrLn "================"
  position "sequencer" (bestSequencedBlockNumber <$> bestSequencedBlock) "<best_sequenced>  strato-sequencer, last committed block"
  position "vm"        vmBest                                            "vm_best_block     vm-runner :8009/metrics, last block executed"
  position "indexed"   (bestBlockNumber <$> bestBlock)                   "<best>            strato-indexer, last vm-runner batch committed to SQL/Redis"
  position "cirrus"    cirrusBest                                        "<cirrus_best>     slipstream, last block indexed into Cirrus"
  position "world"     (bestBlockNumber <$> worldsBestBlock)             "<worldbest>       strato-p2p, highest block reported by any peer"
  putStrLn ""

  putStrLn "Best Block (indexed):"
  putStrLn "====================="
  case bestBlock of
    Nothing -> putStrLn "No best block in Redis"
    Just b -> putStrLn $ format b

  putStrLn "Best Sequenced Block:"
  putStrLn "====================="
  case bestSequencedBlock of
    Nothing -> putStrLn "No best sequenced block in Redis"
    Just b -> putStrLn $ format b

  putStrLn "World Best Block:"
  putStrLn "================="
  case worldsBestBlock of
    Nothing -> putStrLn "No world best block in Redis"
    Just b -> putStrLn $ format b

  putStrLn "Sync Status:"
  putStrLn "============"
  case syncStatus of
    Nothing -> putStrLn "No sync status in Redis"
    Just b -> putStrLn $ format b

  putStrLn ""

  putStrLn "Sync Status Now:"
  putStrLn "================"
  case syncStatusNow of
    Nothing -> putStrLn "No sync status in Redis"
    Just b -> putStrLn $ format b

  putStrLn ""
  where
    -- The vm-runner exposes its position as a Prometheus gauge; no store in between.
    vmBestBlock :: IO (Maybe Integer)
    vmBestBlock = do
      let url = "http://" ++ apiListenAddress (apiConfig ethConf) ++ ":8009/metrics"
      r <- try $ newManager defaultManagerSettings >>= \m -> parseRequest url >>= \q -> httpLbs q m
      pure $ case r of
        Left (_ :: SomeException) -> Nothing
        Right resp ->
          case [v | l <- BL.lines (responseBody resp), ["vm_best_block", v] <- [BL.words l]] of
            (v : _) -> truncate <$> (readMaybe (BL.unpack v) :: Maybe Double)
            [] -> Nothing

    position :: String -> Maybe Integer -> String -> IO ()
    position label n desc = printf "%-10s %-12s %s\n" (label ++ ":") (maybe "-" show n) desc
