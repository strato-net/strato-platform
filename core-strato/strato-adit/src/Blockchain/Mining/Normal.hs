{-# LANGUAGE FlexibleContexts #-}

module Blockchain.Mining.Normal (normalMiner) where

import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.Mining
import           Control.Concurrent
import           Control.Monad.IO.Class
import           Data.Random.Normal

import           Blockchain.EthConf
import           Blockchain.Mining.Options

normalMiner :: Miner
normalMiner = Miner mineNormal verifyNormal

mineNormal :: Block -> IO (Maybe Integer)
mineNormal _ = do
            _ <- liftIO $ randomDelay (fromIntegral . (1000 *) . blockTime $ blockConfig ethConf) flags_variance
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
