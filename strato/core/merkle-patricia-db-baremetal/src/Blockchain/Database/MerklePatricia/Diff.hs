{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-full-laziness -fno-cse #-}

-- | Drop-in replacement for merkle-patricia-db's Diff module: the C walk
-- when a store is active, the Haskell one otherwise.
module Blockchain.Database.MerklePatricia.Diff (dbDiff, DiffOp (..)) where

import Blockchain.Data.RLP (rlpDeserialize)
import Blockchain.Database.MerklePatricia (active, viaC)
import "merkle-patricia-db" Blockchain.Database.MerklePatricia.Diff (DiffOp (..))
import qualified "merkle-patricia-db" Blockchain.Database.MerklePatricia.Diff as HS
import Blockchain.Database.MerklePatricia.Internal (NodeData, StateRoot (..))
import qualified Blockchain.Database.MerklePatriciaNative as N
import Control.Monad.Change.Alter

{-# NOINLINE dbDiff #-}
dbDiff :: (StateRoot `Alters` NodeData) m => StateRoot -> StateRoot -> m [DiffOp]
dbDiff a@(StateRoot ra) b@(StateRoot rb) = case active a of
  Just h -> viaC h $ fmap (map toOp) <$> N.dbDiff h ra rb
  Nothing -> HS.dbDiff a b
  where
    toOp (k, Nothing, Just v) = Create k (rlpDeserialize v)
    toOp (k, Just o, Just n) = Update k (rlpDeserialize o) (rlpDeserialize n)
    toOp (k, Just o, Nothing) = Delete k (rlpDeserialize o)
    toOp (_, Nothing, Nothing) = error "merkle-patricia-db-baremetal: diff op with neither value"
