{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-full-laziness -fno-cse #-}

-- | Drop-in replacement for fastMP's "BatchMerge": one C call per batch
-- when a C store is active, the Haskell batch merge otherwise.
module BatchMerge
  ( putManyKeyVal,
    putManyKeyValExisted,
  )
where

import BlockApps.Logging (MonadLogger)
import Blockchain.Data.RLP (rlpSerialize)
import Blockchain.Database.MerklePatricia
import qualified Blockchain.Database.MerklePatriciaNative as N
import qualified Control.Monad.Change.Alter as A
import qualified "fastMP" BatchMerge as HS

putManyKeyVal ::
  (MonadLogger m, (StateRoot `A.Alters` NodeData) m) =>
  StateRoot ->
  [(Key, Val)] ->
  m StateRoot
putManyKeyVal sr kvs = fst <$> putManyKeyValExisted sr kvs

-- | 'putManyKeyVal' that also returns which of the given keys already had a
-- value in the trie.
{-# NOINLINE putManyKeyValExisted #-}
putManyKeyValExisted ::
  (MonadLogger m, (StateRoot `A.Alters` NodeData) m) =>
  StateRoot ->
  [(Key, Val)] ->
  m (StateRoot, [Key])
putManyKeyValExisted sr@(StateRoot root) kvs = case active sr of
  Just h -> viaC h $ fmap existed <$> N.putManyKeyVal h root [(keyBytes k, rlpSerialize v) | (k, v) <- kvs]
  Nothing -> HS.putManyKeyValExisted sr kvs
  where
    existed (root', flags) = (StateRoot root', [k | ((k, _), True) <- zip kvs flags])
