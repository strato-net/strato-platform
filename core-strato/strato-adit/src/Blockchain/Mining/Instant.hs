{-# LANGUAGE FlexibleContexts #-}

module Blockchain.Mining.Instant (instantMiner) where

import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.Mining

instantMiner::Miner
instantMiner = Miner mineInstant verifyInstant

mineInstant :: Block -> IO (Maybe Integer)
mineInstant _ = do
            return $ Just 6

verifyInstant :: Block -> Bool
verifyInstant Block{blockBlockData=bd} =
    nonce == 6
      where nonce = blockDataNonce bd
