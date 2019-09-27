{-# LANGUAGE ScopedTypeVariables #-}
module CanonRedis where

import           Control.Monad.IO.Class
import           Control.Monad
import           Data.Monoid                           ((<>))
import           Database.Redis

-- import           Blockchain.EthConf                    (lookupRedisBlockDBConfig)
import           Blockchain.Data.DataDefs
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.RedisBlockDB
import           Blockchain.Strato.RedisBlockDB.Models


canonRedis :: String -> Int -> Int -> IO ()
canonRedis ip start range = do
    conn <- connect defaultConnectInfo{connectHost=ip}
    runRedis conn $ do
      mbestBlockNumber <- getBestBlockNumber
      case mbestBlockNumber of
        Nothing -> liftIO $ putStrLn "Could not obtain best block number"
        Just best -> do
          liftIO . putStrLn $ "Got best block " ++ (show best)
          let chunkSize = 5
              range' = min range (best - start)
              starts = [start,start+chunkSize..start+range'-1]
          forM_ starts $ \s -> do
            hs <- getCanonicalHeaderChain (fromIntegral $ s) chunkSize
            let pHash = blockDataParentHash . snd $ head hs
                pNum  = (blockDataNumber . snd . head $ hs) - 1
            parentIsCanon <- isCanonical pHash pNum
            if parentIsCanon
              then validateChainAndLogInvalid hs
              else do
                liftIO $ putStrLn "Parent of block not in Canonical"
                liftIO $ printBlockHeader $ head hs

  where
    getBestBlockNumber :: Redis (Maybe Int)
    getBestBlockNumber = ((fromIntegral . bestBlockNumber) <$>) <$>  getBestBlockInfo

    validateChainAndLogInvalid :: [(SHA,BlockData)] -> Redis ()
    validateChainAndLogInvalid hs = do
      let b = head hs
          bs = tail hs
      foldM_ validateMethod b bs

    validateMethod :: (SHA,BlockData) -> (SHA,BlockData) -> Redis (SHA,BlockData)
    validateMethod prev curr = do
      if (fst prev == (blockDataParentHash . snd $ curr) )
        then return ()
        else do
          liftIO $ putStrLn "Invalid Parent Header relation."
          liftIO $ printBlockHeader curr
          liftIO $ printBlockHeader prev
      return curr

    isCanonical :: SHA -> Integer -> Redis Bool
    isCanonical hsh num = (== Just hsh) <$> getCanonical num

    printBlockHeader :: (SHA,BlockData) -> IO ()
    printBlockHeader (sha, h) = do
      putStrLn $ "Number "
        <> show (blockDataNumber h)
        <> " -- Hash "
        <> show (shaToHex $ sha)
        <> " -- Parent hash "
        <> show (shaToHex $ blockDataParentHash h)

