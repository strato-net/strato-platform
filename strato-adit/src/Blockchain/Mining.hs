{-# LANGUAGE FlexibleContexts,
             FlexibleInstances,
             TypeSynonymInstances,
             ConstraintKinds, 
             RankNTypes, 
             OverloadedStrings, 
             GeneralizedNewtypeDeriving, 
             StandaloneDeriving #-}

module Blockchain.Mining (Miner(..), 
                          MinerType(..)
                          )
where

import Blockchain.Data.DataDefs

data MinerType = Normal | SHA | Instant deriving (Show, Read, Eq)

data Miner = Miner { 
        miner :: Block -> IO (Maybe Integer),
        verify :: Block -> Bool
    }
