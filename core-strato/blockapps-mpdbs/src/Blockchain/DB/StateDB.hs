{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}

module Blockchain.DB.StateDB where

import           Prelude hiding (lookup)
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.ExtWord
import           Control.DeepSeq
import           Control.Monad.Change
import qualified Database.LevelDB                   as DB

type StateDB = DB.DB

instance NFData StateDB where
  rnf db = db `seq` ()

type HasStateDB m = ( (MP.StateRoot `Alters` MP.NodeData) m
                    , (Maybe Word256 `Alters` MP.StateRoot) m
                    )

getStateRoot :: HasStateDB m => Maybe Word256 -> m MP.StateRoot
getStateRoot = lookupWithDefault (Proxy @MP.StateRoot)

setStateDBStateRoot :: HasStateDB m => Maybe Word256 -> MP.StateRoot -> m ()
setStateDBStateRoot cid = insert (Proxy @MP.StateRoot) cid
