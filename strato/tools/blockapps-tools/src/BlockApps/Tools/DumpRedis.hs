module BlockApps.Tools.DumpRedis where

import Blockchain.EthConf (lookupRedisBlockDBConfig)
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.RedisBlockDB
import Blockchain.Strato.RedisBlockDB.Models
import Database.Redis

dumpRedis :: Integer -> IO ()
dumpRedis _ = do
  conn <- checkedConnect lookupRedisBlockDBConfig
  bb <- runRedis conn getBestBlockInfo
  case bb of
    Nothing -> putStrLn "No best block in Redis"
    Just b -> putStrLn . formatBB $ b

formatBB :: RedisBestBlock -> String
formatBB b =
  unlines
    [ ("Best block number:\t" ++) . show . bestBlockNumber $ b,
      ("Best block hash:\t" ++) . keccak256ToHex . bestBlockHash $ b
    ]
