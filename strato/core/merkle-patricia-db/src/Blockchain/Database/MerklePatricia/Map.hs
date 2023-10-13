{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Database.MerklePatricia.Map
  ( map,
  )
where

--In the Haskel sense of the word, 'map' is perhaps the incorrect word to use here.
--This is more of a 'mapM', but this is a one-off situation that is
--more about iterating over the full MP space than a complete functional treatment
--of the MP tree.  I could also call this traverse, but I think it makes
--more sense to just go with the simple term here.

import Blockchain.Data.RLP
import Blockchain.Database.MerklePatricia
import Blockchain.Database.MerklePatricia.Internal
import Blockchain.Database.MerklePatricia.NodeData
import Control.Monad
import Control.Monad.Change.Alter
import qualified Data.NibbleString as N
import Prelude hiding (map)

map ::
  (StateRoot `Alters` NodeData) m =>
  (Key -> RLPObject -> m ()) ->
  StateRoot ->
  m ()
map f = mapNodeRef "" f . ptrRef

mapNodeData ::
  (StateRoot `Alters` NodeData) m =>
  Key ->
  (Key -> RLPObject -> m ()) ->
  NodeData ->
  m ()
mapNodeData _ _ EmptyNodeData = return ()
mapNodeData partialKey f FullNodeData {choices = choices', nodeVal = maybeV} = do
  forM_ (zip [0 ..] choices') $ \(k, ch) -> do
    mapNodeRef (partialKey `N.append` N.singleton k) f ch
  case maybeV of
    Nothing -> return ()
    Just v -> f partialKey v
mapNodeData partialKey f ShortcutNodeData {nextNibbleString = remainingKey, nextVal = nv} =
  case nv of
    Left nr -> mapNodeRef (partialKey `N.append` remainingKey) f nr
    Right v -> f (partialKey `N.append` remainingKey) v

mapNodeRef ::
  (StateRoot `Alters` NodeData) m =>
  Key ->
  (Key -> RLPObject -> m ()) ->
  NodeRef ->
  m ()
mapNodeRef partialKey f (Right sr) = do
  nodeData <- getNodeData (ptrRef sr)
  mapNodeData partialKey f nodeData
mapNodeRef _ _ (Left _) = return () --TODO I might have to deal with this also
