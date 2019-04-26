{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Database.MerklePatricia.Map (
  map
  ) where

--In the Haskel sense of the word, 'map' is perhaps the incorrect word to use here.
--This is more of a 'mapM', but this is a one-off situation that is
--more about iterating over the full MP space than a complete functional treatment
--of the MP tree.  I could also call this traverse, but I think it makes
--more sense to just go with the simple term here.

import           Prelude                                     hiding (map)

import           Control.Monad.IO.Class
import qualified Data.NibbleString                           as N
import qualified Data.Vector                                 as V
import qualified Database.LevelDB                            as LDB

import           Blockchain.Data.RLP
import           Blockchain.Database.MerklePatricia
import           Blockchain.Database.MerklePatricia.Internal
import           Blockchain.Database.MerklePatricia.NodeData

map::MonadIO m=>(Key->RLPObject->m ())->MPDB->m ()
map f mpdb = do
  mapNodeRef (ldb mpdb) "" f (PtrRef $ stateRoot mpdb)

mapNodeData::MonadIO m=>LDB.DB->Key->(Key->RLPObject->m ())->NodeData->m ()
mapNodeData _ _ _ EmptyNodeData = return ()
mapNodeData db partialKey f FullNodeData {choices=choices', nodeVal = maybeV} = do
  flip V.imapM_ choices' $ \k ch -> do
    mapNodeRef db (partialKey `N.append` N.singleton (fromIntegral k)) f ch
  case maybeV of
       Nothing -> return ()
       Just v  -> f partialKey v
mapNodeData db partialKey f ShortcutNodeData {nextNibbleString=remainingKey, nextVal=nv} =
  case nv of
   Left nr -> mapNodeRef db (partialKey `N.append` remainingKey) f nr
   Right v -> f (partialKey `N.append` remainingKey) v


mapNodeRef::MonadIO m=>LDB.DB->Key->(Key->RLPObject->m ())->NodeRef->m ()
mapNodeRef db partialKey f (PtrRef sr) = do
  nodeData <- getNodeData (MPDB db sr) $ PtrRef sr
  mapNodeData db partialKey f nodeData
mapNodeRef _ _ _ (SmallRef _) = return () --TODO I might have to deal with this also

