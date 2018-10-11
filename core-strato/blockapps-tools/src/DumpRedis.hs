module DumpRedis where
import           Database.Redis

import           Blockchain.EthConf                    (lookupRedisBlockDBConfig)
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.RedisBlockDB
import           Blockchain.Strato.RedisBlockDB.Models

dumpRedis :: Integer -> IO ()
dumpRedis _ = do
    conn <- checkedConnect lookupRedisBlockDBConfig
    bb <- runRedis conn getBestBlockInfo
    case bb of
        Nothing -> putStrLn "No best block in Redis"
        Just b  -> putStrLn . formatBB $ b

formatBB :: RedisBestBlock -> String
formatBB b = unlines [ ("Best block number:\t" ++) . show . bestBlockNumber $ b
                     , ("Best block tot. diff:\t" ++) . show . bestBlockTotalDifficulty $ b
                     , ("Best block hash:\t" ++) . shaToHex . bestBlockHash $ b
                     ]
