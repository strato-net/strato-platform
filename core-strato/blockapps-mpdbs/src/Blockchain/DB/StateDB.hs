{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}

module Blockchain.DB.StateDB where

import qualified Blockchain.Database.MerklePatricia as MP
import           Control.DeepSeq
import           Control.Monad.Change
import qualified Database.LevelDB                   as DB

type StateDB = DB.DB

instance NFData StateDB where
  rnf db = db `seq` ()

type HasStateDB m = ((MP.StateRoot `Alters` MP.NodeData) m, Modifiable MP.StateRoot m)

getStateDB :: HasStateDB m => m MP.StateRoot
getStateDB = get (Proxy @MP.StateRoot)

setStateDBStateRoot :: HasStateDB m => MP.StateRoot -> m ()
setStateDBStateRoot = put (Proxy @MP.StateRoot)
