module Blockchain.Database.MerklePatricia.ForEach where

import           Control.Monad.IO.Class
import           Data.NibbleString (NibbleString)
import qualified Data.NibbleString                            as N
import qualified Data.Vector                                  as V

import           Blockchain.Database.MerklePatricia.Internal
import           Blockchain.Database.MerklePatricia.NodeData

forEach::MonadIO m=>MPDB->(Key->Val->m ())->m ()
forEach db f =
  let dbNodeRef = PtrRef $ stateRoot db
  in forEach_NodeRef db dbNodeRef N.empty f


forEach_NodeData::MonadIO m=>MPDB->NodeData->NibbleString->(Key->Val->m ())->m ()

forEach_NodeData _ EmptyNodeData _ _ = return ()

forEach_NodeData db (FullNodeData {choices=cs}) partialKey f =
  flip V.imapM_ cs $ \n ref ->
    forEach_NodeRef db ref (partialKey `N.append` N.singleton (fromIntegral n)) f

forEach_NodeData db ShortcutNodeData{nextNibbleString=s, nextVal=Left ref} partialKey f =
  forEach_NodeRef db ref (partialKey `N.append` s) f

forEach_NodeData _ ShortcutNodeData{nextNibbleString=s, nextVal=Right val} partialKey f =
  f (partialKey `N.append` s) val



forEach_NodeRef::MonadIO m=>MPDB->NodeRef->NibbleString->(Key->Val->m ())->m ()
forEach_NodeRef db ref partialKey f = do
  nodeData <- getNodeData db ref
  forEach_NodeData db nodeData partialKey f
