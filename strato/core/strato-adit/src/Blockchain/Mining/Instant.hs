{-# LANGUAGE FlexibleContexts #-}

module Blockchain.Mining.Instant (instantMiner) where

import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.Mining

instantMiner::Miner
instantMiner = Miner mineInstant verifyInstant

mineInstant :: Block -> IO (Maybe Integer)
mineInstant = return . Just . fromIntegral . blockDataNonce . blockBlockData

verifyInstant :: Block -> Bool
verifyInstant = const True
