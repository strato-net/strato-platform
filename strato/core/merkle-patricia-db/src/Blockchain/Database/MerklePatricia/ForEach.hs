{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Database.MerklePatricia.ForEach where

import Blockchain.Database.MerklePatricia.Internal
import Blockchain.Database.MerklePatricia.NodeData
import Control.Monad
import Control.Monad.Change.Alter
import Data.NibbleString (NibbleString)
import qualified Data.NibbleString as N

forEach ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  (Key -> Val -> m ()) ->
  m ()
forEach sr = forEach_NodeRef (ptrRef sr) N.empty

forEach_NodeData ::
  (StateRoot `Alters` NodeData) m =>
  NodeData ->
  NibbleString ->
  (Key -> Val -> m ()) ->
  m ()
forEach_NodeData EmptyNodeData _ _ = return ()
forEach_NodeData (FullNodeData {choices = cs}) partialKey f =
  forM_ (zip cs [0 ..]) $ \(ref, n) ->
    forEach_NodeRef ref (partialKey `N.append` N.singleton n) f
forEach_NodeData ShortcutNodeData {nextNibbleString = s, nextVal = Left ref} partialKey f =
  forEach_NodeRef ref (partialKey `N.append` s) f
forEach_NodeData ShortcutNodeData {nextNibbleString = s, nextVal = Right val} partialKey f =
  f (partialKey `N.append` s) val

forEach_NodeRef ::
  (StateRoot `Alters` NodeData) m =>
  NodeRef ->
  NibbleString ->
  (Key -> Val -> m ()) ->
  m ()
forEach_NodeRef ref partialKey f = do
  nodeData <- getNodeData ref
  forEach_NodeData nodeData partialKey f
