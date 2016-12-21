{-# LANGUAGE FlexibleContexts #-}

module Blockchain.Mining.Instant (instantMiner) where

import Blockchain.Mining
import Blockchain.Data.DataDefs

instantMiner::Miner
instantMiner = Miner mineInstant verifyInstant

mineInstant :: Block -> IO (Maybe Integer)
mineInstant _ = do
            return $ Just 6

verifyInstant :: Block -> Bool
verifyInstant Block{blockBlockData=bd} = 
    nonce == 6
      where nonce = blockDataNonce bd
