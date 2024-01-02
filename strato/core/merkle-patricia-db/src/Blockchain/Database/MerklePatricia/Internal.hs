{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Blockchain.Database.MerklePatricia.Internal
  ( Key,
    Val,
    StateDB (..),
    StateRoot (..),
    NodeDataF (..),
    NodeData,
    runMP,
    initializeBlank,
    openMPDB,
    emptyTriePtr,
    sha2StateRoot,
    unboxStateRoot,
    unsafePutKeyVal,
    unsafeGetKeyVals,
    unsafeGetAllKeyVals,
    unsafeDeleteKey,
    getNodeData,
    putNodeData,
    putKV_NodeData,
    keyToSafeKey,
    getCommonPrefix,
    replace,
    prependToKey,
    nodeData2NodeRef,
  )
where

import Blockchain.Data.RLP
import Blockchain.Database.MerklePatricia.MPDB
import Blockchain.Database.MerklePatricia.NodeData
import Blockchain.Database.MerklePatricia.StateRoot
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Control.Monad ((<=<))
import Control.Monad.Change.Alter (Alters)
import qualified Control.Monad.Change.Alter as A
import qualified Data.ByteString as B
import Data.Function
import Data.List
import Data.Maybe
import qualified Data.NibbleString as N
import Data.Proxy
import Text.Format

unsafePutKeyVal ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  Key ->
  Val ->
  m StateRoot
unsafePutKeyVal sr key val = do
  dbNodeData <- getNodeData $ ptrRef sr
  dbPutNodeData <- putKV_NodeData key val dbNodeData
  putNodeData dbPutNodeData

unsafeGetKeyVals ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  Key ->
  m [(Key, Val)]
unsafeGetKeyVals sr = getKeyVals_NodeRef $ ptrRef sr

unsafeGetAllKeyVals ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  m [(Key, Val)]
unsafeGetAllKeyVals sr = unsafeGetKeyVals sr N.empty

unsafeDeleteKey ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  Key ->
  m StateRoot
unsafeDeleteKey sr key = do
  dbNodeData <- getNodeData (ptrRef sr)
  dbDeleteNodeData <- deleteKey_NodeData key dbNodeData
  putNodeData dbDeleteNodeData

keyToSafeKey :: N.NibbleString -> N.NibbleString
keyToSafeKey key
  | N.EvenNibbleString keyByteString <- key = N.EvenNibbleString $ keccak256ToByteString $ hash keyByteString
  | otherwise = error $ "keyToSafeKey: key is not an EvenNibbleString: " ++ (show key)

-----

putKV_NodeData ::
  (StateRoot `Alters` NodeData) m =>
  Key ->
  Val ->
  NodeData ->
  m NodeData
putKV_NodeData key val EmptyNodeData =
  return $ ShortcutNodeData key (Right val)
putKV_NodeData key val (FullNodeData options nodeValue)
  | options `slotIsEmpty` N.head key =
    do
      tailNode <- newShortcut (N.tail key) $ Right val
      return $ FullNodeData (replace options (N.head key) tailNode) nodeValue
  | otherwise =
    do
      let conflictingNodeRef = options !! fromIntegral (N.head key)
      newNode <- putKV_NodeRef (N.tail key) val conflictingNodeRef
      return $ FullNodeData (replace options (N.head key) newNode) nodeValue
putKV_NodeData key1 val1 (ShortcutNodeData key2 val2)
  | key1 == key2 =
    case val2 of
      Right _ -> return $ ShortcutNodeData key1 $ Right val1
      Left ref -> do
        newNodeRef <- putKV_NodeRef key1 val1 ref
        return $ ShortcutNodeData key2 (Left newNodeRef)
  | N.null key1 = do
    newNodeRef <- newShortcut (N.tail key2) val2
    return $ FullNodeData (list2Options 0 [(N.head key2, newNodeRef)]) $ Just val1
  | key1 `N.isPrefixOf` key2 = do
    tailNode <- newShortcut (N.drop (N.length key1) key2) val2
    modifiedTailNode <- putKV_NodeRef "" val1 tailNode
    return $ ShortcutNodeData key1 $ Left modifiedTailNode
  | key2 `N.isPrefixOf` key1 =
    case val2 of
      Right val -> putKV_NodeData key2 val (ShortcutNodeData key1 $ Right val1)
      Left ref -> do
        newNode <- putKV_NodeRef (N.drop (N.length key2) key1) val1 ref
        return $ ShortcutNodeData key2 $ Left newNode
  | N.head key1 == N.head key2 =
    let (commonPrefix, suffix1, suffix2) =
          getCommonPrefix (N.unpack key1) (N.unpack key2)
     in do
          nodeAfterCommonBeforePut <- newShortcut (N.pack suffix2) val2
          nodeAfterCommon <- putKV_NodeRef (N.pack suffix1) val1 nodeAfterCommonBeforePut
          return $ ShortcutNodeData (N.pack commonPrefix) $ Left nodeAfterCommon
  | otherwise = do
    tailNode1 <- newShortcut (N.tail key1) $ Right val1
    tailNode2 <- newShortcut (N.tail key2) val2
    return $
      FullNodeData
        ( list2Options 0 $
            sortBy
              (compare `on` fst)
              [(N.head key1, tailNode1), (N.head key2, tailNode2)]
        )
        Nothing

-----

getKeyVals_NodeData ::
  (StateRoot `Alters` NodeData) m =>
  NodeData ->
  Key ->
  m [(Key, Val)]
getKeyVals_NodeData EmptyNodeData _ = return []
getKeyVals_NodeData (FullNodeData {choices = cs}) "" = do
  partialKVs <- sequence $ (\ref -> getKeyVals_NodeRef ref "") <$> cs
  return $
    concatMap
      (uncurry $ map . (prependToKey . N.singleton))
      (zip [0 ..] partialKVs)
getKeyVals_NodeData (FullNodeData {choices = cs}) key
  | ref == emptyRef = return []
  | otherwise =
    fmap (prependToKey $ N.singleton $ N.head key)
      <$> getKeyVals_NodeRef ref (N.tail key)
  where
    ref = cs !! fromIntegral (N.head key)
getKeyVals_NodeData ShortcutNodeData {nextNibbleString = s, nextVal = Left ref} key
  | key `N.isPrefixOf` s = prependNext ""
  | s `N.isPrefixOf` key = prependNext $ N.drop (N.length s) key
  | otherwise = return []
  where
    prependNext key' = fmap (prependToKey s) <$> getKeyVals_NodeRef ref key'
getKeyVals_NodeData ShortcutNodeData {nextNibbleString = s, nextVal = Right val} key =
  return $
    if key `N.isPrefixOf` s
      then [(s, val)]
      else []

-----

deleteKey_NodeData :: (StateRoot `Alters` NodeData) m => Key -> NodeData -> m NodeData
deleteKey_NodeData _ EmptyNodeData = return EmptyNodeData
deleteKey_NodeData key nd@(FullNodeData options val)
  | N.null key = return $ FullNodeData options Nothing
  | options `slotIsEmpty` N.head key = return nd
  | otherwise = do
    let nodeRef = options !! fromIntegral (N.head key)
    newNodeRef <- deleteKey_NodeRef (N.tail key) nodeRef
    let newOptions = replace options (N.head key) newNodeRef
    simplify_NodeData $ FullNodeData newOptions val
deleteKey_NodeData key1 nd@(ShortcutNodeData key2 (Right _)) =
  return $
    if key1 == key2
      then EmptyNodeData
      else nd
deleteKey_NodeData key1 nd@(ShortcutNodeData key2 (Left ref))
  | key2 `N.isPrefixOf` key1 = do
    newNodeRef <- deleteKey_NodeRef (N.drop (N.length key2) key1) ref
    simplify_NodeData $ ShortcutNodeData key2 $ Left newNodeRef
  | otherwise = return nd

-----

putKV_NodeRef :: (StateRoot `Alters` NodeData) m => Key -> Val -> NodeRef -> m NodeRef
putKV_NodeRef key val = nodeData2NodeRef <=< putKV_NodeData key val <=< getNodeData

getKeyVals_NodeRef :: (StateRoot `Alters` NodeData) m => NodeRef -> Key -> m [(Key, Val)]
getKeyVals_NodeRef ref key = do
  nodeData <- getNodeData ref
  getKeyVals_NodeData nodeData key

--TODO- This is looking like a lift, I probably should make NodeRef some sort of Monad....

deleteKey_NodeRef :: (StateRoot `Alters` NodeData) m => Key -> NodeRef -> m NodeRef
deleteKey_NodeRef key = nodeData2NodeRef <=< deleteKey_NodeData key <=< getNodeData

-----

getNodeData :: (StateRoot `Alters` NodeData) m => NodeRef -> m NodeData
getNodeData (Left x) = pure $ rlpDecode $ rlpDeserialize x
getNodeData (Right sr) =
  fromMaybe (error $ "Missing StateRoot in call to getNodeData: " ++ format sr)
    <$> A.lookup Proxy sr

putNodeData :: (StateRoot `Alters` NodeData) m => NodeData -> m StateRoot
putNodeData nd = do
  let bytes = rlpSerialize $ rlpEncode nd
      ptr = StateRoot $ keccak256ToByteString $ hash bytes
  A.insert Proxy ptr nd
  return ptr

-----

-- Only used to canonicalize the DB after a
-- delete.  We need to concatinate ShortcutNodeData links, convert
-- FullNodeData to ShortcutNodeData when possible, etc.

-- Important note- this function should only apply to immediate items,
-- and not recurse deep into the database (ie- by simplifying all options
-- in a FullNodeData, etc).  Failure to adhere will result in a
-- performance nightmare!  Any delete could result in a full read through
-- the whole database.  The delete function only will "break" the
-- canonical structure locally, so deep recursion isn't required.

simplify_NodeData :: (StateRoot `Alters` NodeData) m => NodeData -> m NodeData
simplify_NodeData EmptyNodeData = return EmptyNodeData
simplify_NodeData nd@(ShortcutNodeData key (Left ref)) = do
  refNodeData <- getNodeData ref
  case refNodeData of
    (ShortcutNodeData key2 v2) -> return $ ShortcutNodeData (key `N.append` key2) v2
    _ -> return nd
simplify_NodeData (FullNodeData options Nothing) = do
  case options2List options of
    [(n, nodeRef)] ->
      simplify_NodeData $ ShortcutNodeData (N.singleton n) $ Left nodeRef
    _ -> return $ FullNodeData options Nothing
simplify_NodeData x = return x

-----

newShortcut :: (StateRoot `Alters` NodeData) m => Key -> Either NodeRef Val -> m NodeRef
newShortcut "" (Left ref) = return ref
newShortcut key val = nodeData2NodeRef $ ShortcutNodeData key val

nodeData2NodeRef :: (StateRoot `Alters` NodeData) m => NodeData -> m NodeRef
nodeData2NodeRef nodeData =
  case rlpSerialize $ rlpEncode nodeData of
    bytes | B.length bytes < 32 -> return $ smallRef bytes
    _ -> ptrRef <$> putNodeData nodeData

list2Options :: N.Nibble -> [(N.Nibble, NodeRef)] -> [NodeRef]
list2Options start [] = replicate (fromIntegral $ 0x10 - start) emptyRef
list2Options start x
  | start > 15 =
    error $
      "value of 'start' in list2Option is greater than 15, it is: " ++ show start
        ++ ", second param is "
        ++ show x
list2Options start ((firstNibble, firstPtr) : rest) =
  replicate (fromIntegral $ firstNibble - start) emptyRef ++ [firstPtr] ++ list2Options (firstNibble + 1) rest

options2List :: [NodeRef] -> [(N.Nibble, NodeRef)]
options2List theList = filter ((/= emptyRef) . snd) $ zip [0 ..] theList

prependToKey :: Key -> (Key, Val) -> (Key, Val)
prependToKey prefix (key, val) = (prefix `N.append` key, val)

replace :: Integral i => [a] -> i -> a -> [a]
replace lst i newVal = case splitAt (fromIntegral i) lst of
  (left, _ : right) -> left ++ [newVal] ++ right
  _ -> lst -- case where i is greater than or equal to the length of lst

slotIsEmpty :: [NodeRef] -> N.Nibble -> Bool
slotIsEmpty [] _ =
  error "slotIsEmpty was called for value greater than the size of the list"
slotIsEmpty (x : _) 0 | x == emptyRef = True
slotIsEmpty _ 0 = False
slotIsEmpty (_ : rest) n = slotIsEmpty rest (n - 1)

getCommonPrefix :: Eq a => [a] -> [a] -> ([a], [a], [a])
getCommonPrefix (c1 : rest1) (c2 : rest2)
  | c1 == c2 = prefixTheCommonPrefix c1 (getCommonPrefix rest1 rest2)
  where
    prefixTheCommonPrefix c (p, x, y) = (c : p, x, y)
getCommonPrefix x y = ([], x, y)
