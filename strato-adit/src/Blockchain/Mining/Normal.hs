{-# LANGUAGE FlexibleContexts #-}

module Blockchain.Mining.Normal (normalMiner) where

import Blockchain.Mining
import Blockchain.Data.DataDefs
import Control.Concurrent
import Data.Random.Normal
import Control.Monad.IO.Class

import Blockchain.Mining.Options

normalMiner :: Miner
normalMiner = Miner mineNormal verifyNormal

mineNormal :: Block -> IO (Maybe Integer)
mineNormal _ = do
            r <- liftIO $ randomDelay flags_blocktime flags_variance
            --printf "Sleeping for %6.2fs\n" (r / 1000) :: Double
            putStrLn $ "Sleeping for " ++ (show r) ++ " milliseconds"
            return $ Just 6

verifyNormal :: Block -> Bool
verifyNormal Block{blockBlockData=bd} = 
    nonce == 6
      where nonce = blockDataNonce bd

-- simulate a gaussian process 
randomDelay :: Int -> Int -> IO (Int)
randomDelay mean var = do 
            -- threadDelay is in microseconds and arguments in milliseconds
            waitTime <- normalIO' (fromIntegral mean*1000 :: Float, fromIntegral var*1000 :: Float)
            threadDelay $ round waitTime
            return $ round waitTime