{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE UndecidableInstances  #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}

module Blockchain.DB.StateDB where

import qualified Blockchain.Database.MerklePatricia as MP
import           Control.Monad.Change.Modify
import           Data.Proxy

instance (Monad m, Modifiable MP.MPDB m) => Modifiable MP.StateRoot m where
  modify _ f = fmap MP.stateRoot . modify Proxy $ \mpdb -> do
    sr <- f $ MP.stateRoot mpdb
    return mpdb{MP.stateRoot = sr}
