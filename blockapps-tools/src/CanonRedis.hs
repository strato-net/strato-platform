{-# LANGUAGE ScopedTypeVariables #-}
module CanonRedis where

import           Control.Monad.IO.Class
import           Data.Monoid                           ((<>))
import           Database.Redis
import Data.Foldable

-- import           Blockchain.EthConf                    (lookupRedisBlockDBConfig)
import           Blockchain.Data.BlockHeader
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.RedisBlockDB
import           Blockchain.Strato.RedisBlockDB.Models


canonRedis :: String -> Int -> Int -> IO ()
canonRedis ip start range = do
    conn <- connect defaultConnectInfo{connectHost=ip}
    -- conn <- connect defaultConnectInfo{connectHost="40.76.17.40"}
    -- conn <- connect defaultConnectInfo{connectHost="13.72.79.3"}
    -- conn <- connect defaultConnectInfo{connectHost="40.76.29.122"}
    runRedis conn $ do
      Just bestBlockNumer <- getBestBlockNumber
      let range' = min range (bestBlockNumer - start)
          starts = [start,start+500..range']
      forM_ starts $ \s -> do
        shas <- getCanonicalChain (fromIntegral $ s) 500
        hs :: [(SHA, Maybe BlockHeader)] <- getHeaders shas
        liftIO $ mapM_ printBlockHeader hs

  where
    getBestBlockNumber = ((fromIntegral . bestBlockNumber) <$>) <$>  getBestBlockInfo
    
printBlockHeader :: (SHA,Maybe BlockHeader) -> IO ()
printBlockHeader (sha, Just h) = do
  liftIO . putStrLn $ "Number "
                   <> show (blockHeaderBlockNumber h)
                   <> " -- Hash "
                   <>show (shaToHex $ sha)
                   <> " -- Parent hash "
                   <> show (shaToHex $ blockHeaderParentHash h)
printBlockHeader _ = undefined

-- dumpRedis :: Integer -> IO ()
-- dumpRedis _ = do
--     conn <- checkedConnect lookupRedisBlockDBConfig
--     bb <- runRedis conn getBestBlockInfo
--     case bb of
--         Nothing -> putStrLn "No best block in Redis"
--         Just b  -> putStrLn . formatBB $ b

formatBB :: RedisBestBlock -> String
formatBB b = unlines [ ("Best block number:\t" ++) . show . bestBlockNumber $ b
                     , ("Best block tot. diff:\t" ++) . show . bestBlockTotalDifficulty $ b
                     , ("Best block hash:\t" ++) . shaToHex . bestBlockHash $ b
                     ]
