{-# LANGUAGE ConstraintKinds            #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE RankNTypes                 #-}
{-# LANGUAGE StandaloneDeriving         #-}
{-# LANGUAGE TypeSynonymInstances       #-}

module Blockchain.Mining (Miner(..),
                          MinerType(..)
                          )
where

import           Blockchain.Data.Block

data MinerType = Normal | SHA | Instant deriving (Show, Read, Eq)

data Miner = Miner {
        miner  :: Block -> IO (Maybe Integer),
        verify :: Block -> Bool
    }
