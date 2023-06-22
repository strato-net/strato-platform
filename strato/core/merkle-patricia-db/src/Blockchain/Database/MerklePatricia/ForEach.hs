{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE TypeOperators        #-}
{-# LANGUAGE ScopedTypeVariables  #-}

module Blockchain.Database.MerklePatricia.ForEach where

import           Control.Monad
import           Control.Monad.Change.Alter
import           Data.ByteString                              (ByteString)
import           Data.NibbleString                            (NibbleString)
import qualified Data.NibbleString                            as N

import           Blockchain.Database.MerklePatricia.Internal
import           Blockchain.Database.MerklePatricia.NodeData
import           Blockchain.Strato.Model.Util

forEach :: (StateRoot `Alters` NodeData) m
        => StateRoot -> (Key -> Val -> m ()) -> m ()
forEach sr = forEach_NodeRef (PtrRef sr) N.empty

forEach_NodeData :: (StateRoot `Alters` NodeData) m
                 => NodeData -> NibbleString -> (Key -> Val -> m ()) -> m ()

forEach_NodeData EmptyNodeData _ _ = return ()

forEach_NodeData (FullNodeData {choices=cs}) partialKey f =
  forM_ (zip cs [0..]) $ \(ref, n) ->
    forEach_NodeRef ref (partialKey `N.append` N.singleton n) f

forEach_NodeData ShortcutNodeData{nextNibbleString=s, nextVal=Left ref} partialKey f =
  forEach_NodeRef ref (partialKey `N.append` s) f

forEach_NodeData ShortcutNodeData{nextNibbleString=s, nextVal=Right val} partialKey f =
  f (partialKey `N.append` s) val

forEach_NodeRef :: (StateRoot `Alters` NodeData) m
                => NodeRef -> NibbleString -> (Key -> Val -> m ()) -> m ()
forEach_NodeRef ref partialKey f = do
  nodeData <- getNodeData ref
  forEach_NodeData nodeData partialKey f

-----------------------------
-- Below code is related to SnapSync
getAllLeafKeyVals :: (StateRoot `Alters` NodeData) m => StateRoot -> m [(ByteString, Val)]
getAllLeafKeyVals sr = forEach_NodeRef_Get_NodeData (PtrRef sr) N.empty

forEach_NodeRef_Get_NodeData :: (StateRoot `Alters` NodeData) m
                              => NodeRef 
                              -> NibbleString
                              -> m [(ByteString, Val)]
forEach_NodeRef_Get_NodeData ref partialKey = do
  nodeData <- getNodeData ref
  forEach_NodeData_Get_KeyVal nodeData partialKey

forEach_NodeData_Get_KeyVal :: (StateRoot `Alters` NodeData) m
                            => NodeData 
                            ->  NibbleString 
                            ->  m [(ByteString, Val)]

forEach_NodeData_Get_KeyVal EmptyNodeData _ = return []

forEach_NodeData_Get_KeyVal (FullNodeData cs Nothing) partialKey = 
  (concat <$>) $ mapM (\(ref, n) -> forEach_NodeRef_Get_NodeData ref (partialKey `N.append` N.singleton n)) $ (zip cs [0..]) 

forEach_NodeData_Get_KeyVal (FullNodeData cs (Just val)) partialKey = 
  let right = (concat <$> ) $ mapM (\(ref, n) -> forEach_NodeRef_Get_NodeData ref (partialKey `N.append` N.singleton n)) $ (zip cs [0..]) 
      left  =  [((nibbleString2ByteString partialKey) , val)]
  in fmap (left ++) right

forEach_NodeData_Get_KeyVal ShortcutNodeData{nextNibbleString = s, nextVal = Left ref} partialKey =
  forEach_NodeRef_Get_NodeData ref (partialKey `N.append` s)

forEach_NodeData_Get_KeyVal ShortcutNodeData{nextNibbleString = s, nextVal = Right val} partialKey = 
  return $ [(((nibbleString2ByteString $ partialKey `N.append` s)) , val)]
