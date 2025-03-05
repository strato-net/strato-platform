module BlockApps.Tools.DumpRedis where

import Blockchain.EthConf (lookupRedisBlockDBConfig)
import Blockchain.Strato.RedisBlockDB
import Database.Redis
import Text.Format

dumpRedis :: Integer -> IO ()
dumpRedis _ = do
  conn <- checkedConnect lookupRedisBlockDBConfig

  bestBlock <- runRedis conn getBestBlockInfo
  case bestBlock of
    Nothing -> putStrLn "No best block in Redis"
    Just b -> putStrLn $ format b

  bestSequencedBlock <- runRedis conn getBestSequencedBlockInfo
  case bestSequencedBlock of
    Nothing -> putStrLn "No best sequenced block in Redis"
    Just b -> putStrLn $ format b
