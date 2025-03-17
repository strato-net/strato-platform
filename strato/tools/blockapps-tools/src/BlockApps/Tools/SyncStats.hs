module BlockApps.Tools.SyncStats where

import Blockchain.EthConf (lookupRedisBlockDBConfig)
import Blockchain.SyncDB
import Database.Redis
import Text.Format

syncStats :: IO ()
syncStats = do
  conn <- checkedConnect lookupRedisBlockDBConfig

  putStrLn "Best Block:"
  putStrLn "==========="
  bestBlock <- runRedis conn getBestBlockInfo
  case bestBlock of
    Nothing -> putStrLn "No best block in Redis"
    Just b -> putStrLn $ format b

  putStrLn "Best Sequenced Block:"
  putStrLn "====================="
  bestSequencedBlock <- runRedis conn getBestSequencedBlockInfo
  case bestSequencedBlock of
    Nothing -> putStrLn "No best sequenced block in Redis"
    Just b -> putStrLn $ format b

  putStrLn "World Best Block:"
  putStrLn "================="
  worldsBestBlock <- runRedis conn getWorldBestBlockInfo
  case worldsBestBlock of
    Nothing -> putStrLn "No best sequenced block in Redis"
    Just b -> putStrLn $ format b

  putStrLn "Sync Status:"
  putStrLn "============"
  syncStatus <- runRedis conn getSyncStatus
  case syncStatus of
    Nothing -> putStrLn "No best sequenced block in Redis"
    Just b -> putStrLn $ format b

  putStrLn ""

  putStrLn "Sync Status Now:"
  putStrLn "================"
  syncStatusNow <- runRedis conn getSyncStatusNow
  case syncStatusNow of
    Nothing -> putStrLn "No best sequenced block in Redis"
    Just b -> putStrLn $ format b

  putStrLn ""
