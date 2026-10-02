module BlockApps.Tools.SyncStats where

import Blockchain.EthConf (lookupRedisBlockDBConfig)
import Blockchain.Model.SyncState
import Blockchain.SyncDB
import Database.Redis
import Text.Format
import Text.Printf (printf)

syncStats :: IO ()
syncStats = do
  conn <- checkedConnect lookupRedisBlockDBConfig

  bestBlock <- runRedis conn getBestBlockInfo
  bestSequencedBlock <- runRedis conn getBestSequencedBlockInfo
  worldsBestBlock <- runRedis conn getWorldBestBlockInfo
  vmBest <- runRedis conn getVmBestBlockNumber
  cirrusBest <- runRedis conn getCirrusBestBlockNumber
  syncStatus <- runRedis conn getSyncStatus
  syncStatusNow <- runRedis conn getSyncStatusNow

  -- One line per stage of the pipeline, in pipeline order. Each stage writes
  -- its own Redis key, so these can legitimately differ while the node is
  -- catching up; the gaps between them show where the backlog is.
  putStrLn "Block Positions:"
  putStrLn "================"
  position "sequencer" (bestSequencedBlockNumber <$> bestSequencedBlock) "<best_sequenced>  strato-sequencer, last committed block"
  position "vm"        vmBest                                            "<vm_best>         vm-runner, last block executed"
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
    position :: String -> Maybe Integer -> String -> IO ()
    position label n desc = printf "%-10s %-12s %s\n" (label ++ ":") (maybe "-" show n) desc
