{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-full-laziness -fno-cse #-}

-- | Drop-in replacement for merkle-patricia-db's Map module: the C walk
-- when a store is active, the Haskell one otherwise.
module Blockchain.Database.MerklePatricia.Map (map) where

import Blockchain.Data.RLP (RLPObject, rlpDeserialize)
import Blockchain.Database.MerklePatricia (active, viaC)
import Blockchain.Database.MerklePatricia.Internal (Key, NodeData, StateRoot (..))
import qualified "merkle-patricia-db" Blockchain.Database.MerklePatricia.Map as HS
import qualified Blockchain.Database.MerklePatriciaNative as N
import Control.Monad (forM_)
import Control.Monad.Change.Alter
import qualified Data.NibbleString as Nib
import Prelude hiding (map)

{-# NOINLINE map #-}
map :: (StateRoot `Alters` NodeData) m => (Key -> RLPObject -> m ()) -> StateRoot -> m ()
map f sr@(StateRoot root) = case active sr of
  Just h -> do
    kvs <- viaC h $ N.forEach h root
    forM_ kvs $ \(k, v) -> f (Nib.pack k) (rlpDeserialize v)
  Nothing -> HS.map f sr
