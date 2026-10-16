{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans -fno-full-laziness -fno-cse #-}

-- | Drop-in replacement for the merkle-patricia-db public module.
--
-- With a C store active ('N.activeHandle') the trie operations hand the
-- root and raw bytes to C, which owns the nodes; otherwise they run the
-- Haskell implementation over the caller's node store.
module Blockchain.Database.MerklePatricia
  ( genericLookupDB,
    genericInsertDB,
    genericDeleteDB,
    Key,
    Val,
    StateDB (..),
    StateRoot (..),
    NodeDataF (..),
    NodeData,
    runMP,
    openMPDB,
    emptyTriePtr,
    sha2StateRoot,
    unboxStateRoot,
    putKeyVal,
    putKeyValExisted,
    getKeyVal,
    deleteKey,
    keyExists,
    initializeBlank,
    blankStateRoot,
    addAllKVs,
    getInclusionProof,
    getProof,

    -- * C dispatch, shared with "BatchMerge"
    active,
    viaC,
    keyBytes,
  )
where

import Blockchain.Data.RLP
import Blockchain.Database.MerklePatricia.Internal
import Blockchain.Database.MerklePatricia.NodeData (ptrRef)
import qualified Blockchain.Database.MerklePatriciaNative as N
import Blockchain.Strato.Model.Util (byteString2NibbleString)
import Control.Monad.Change.Alter
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import qualified Data.ByteString as B
import Data.Default
import Data.IORef (readIORef)
import Data.Maybe (isJust, listToMaybe)
import qualified Data.NibbleString as N
import qualified Database.LevelDB as DB
import System.IO.Unsafe (unsafePerformIO)

-- ================================================================
-- LevelDB generic operations (same as merkle-patricia-db)
-- ================================================================

genericLookupDB :: MonadIO m => m DB.DB -> StateRoot -> m (Maybe NodeData)
genericLookupDB f (StateRoot sr) = do
  db <- f
  fmap bytes2NodeData <$> DB.get db def sr
  where
    bytes2NodeData :: B.ByteString -> NodeData
    bytes2NodeData bytes | B.null bytes = EmptyNodeData
    bytes2NodeData bytes = rlpDecode . rlpDeserialize $ bytes

genericInsertDB :: MonadIO m => m DB.DB -> StateRoot -> NodeData -> m ()
genericInsertDB f (StateRoot sr) nd = do
  db <- f
  DB.put db def sr $ rlpSerialize $ rlpEncode nd

genericDeleteDB :: MonadIO m => m DB.DB -> StateRoot -> m ()
genericDeleteDB f (StateRoot sr) = do
  db <- f
  DB.delete db def sr

instance MonadIO m => (StateRoot `Alters` NodeData) (ReaderT DB.DB m) where
  lookup _ = genericLookupDB ask
  insert _ = genericInsertDB ask
  delete _ = genericDeleteDB ask

-- ================================================================
-- C dispatch
-- ================================================================

-- | The trie functions only have an 'Alters' store, not IO, so C calls run
-- under 'unsafePerformIO'.  Each is tagged with an attempt number so no
-- two are ever the same expression to GHC.
{-# NOINLINE runC #-}
runC :: Int -> IO a -> a
runC n io = unsafePerformIO (if n < 0 then error "runC" else io)

-- | The C store, if this process opened one.  Read on every call: the
-- public functions are NOINLINE and this module disables full laziness
-- and CSE so GHC cannot hoist the read into a once-evaluated constant.
{-# NOINLINE active #-}
active :: StateRoot -> Maybe N.MPHandle
active sr = unsafePerformIO (sr `seq` readIORef N.activeHandle)

-- | Run a C trie operation.  A node the store does not have is looked up
-- through the caller's store (which in the VM may ask peers for it), handed
-- to C, and the operation retried.
{-# NOINLINE viaC #-}
viaC :: (StateRoot `Alters` NodeData) m => N.MPHandle -> IO (Either B.ByteString a) -> m a
viaC h op = attempt 0
  where
    attempt n = do
      let !r = runC n op
      case r of
        Right a -> return a
        Left hash -> do
          mnd <- A.lookup (Proxy @NodeData) (StateRoot hash)
          case mnd of
            Nothing -> error $ "merkle-patricia-db-baremetal: missing trie node " ++ show (StateRoot hash)
            Just nd -> do
              let !() = runC n (N.insertNode h hash (rlpSerialize (rlpEncode nd)))
              attempt (n + 1)

-- | Raw bytes of a key; the trie hashes them itself.
keyBytes :: Key -> B.ByteString
keyBytes (N.EvenNibbleString bs) = bs
keyBytes key = error $ "merkle-patricia-db-baremetal: key is not an EvenNibbleString: " ++ show key

-- ================================================================
-- Public trie API
-- ================================================================

{-# NOINLINE putKeyVal #-}
putKeyVal ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  Key ->
  Val ->
  m StateRoot
putKeyVal sr key val = fst <$> putKeyValExisted sr key val

-- | 'putKeyVal' that also reports whether the key already existed.
{-# NOINLINE putKeyValExisted #-}
putKeyValExisted ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  Key ->
  Val ->
  m (StateRoot, Bool)
putKeyValExisted sr@(StateRoot root) key val = case active sr of
  Just h -> viaC h $ fmap (\(r, ex) -> (StateRoot r, or ex)) <$> N.putManyKeyVal h root [(keyBytes key, rlpSerialize val)]
  Nothing -> unsafePutKeyValExisted sr (keyToSafeKey key) val

{-# NOINLINE getKeyVal #-}
getKeyVal ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  Key ->
  m (Maybe Val)
getKeyVal sr@(StateRoot root) key = case active sr of
  Just h -> viaC h $ fmap (fmap rlpDeserialize) <$> N.getKeyVal h root (keyBytes key)
  Nothing -> fmap snd . listToMaybe <$> unsafeGetKeyVals sr (keyToSafeKey key)

{-# NOINLINE deleteKey #-}
deleteKey ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  Key ->
  m StateRoot
deleteKey sr@(StateRoot root) key = case active sr of
  Just h -> viaC h $ fmap StateRoot <$> N.deleteKey h root (keyBytes key)
  Nothing -> unsafeDeleteKey sr (keyToSafeKey key)

keyExists ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  Key ->
  m Bool
keyExists sr key = isJust <$> getKeyVal sr key

-- | Returns the StateRoot of the blank database.
blankStateRoot :: StateRoot
blankStateRoot = emptyTriePtr

addAllKVs :: (RLPSerializable x, RLPSerializable y, (StateRoot `Alters` NodeData) m) => StateRoot -> [(x, y)] -> m StateRoot
addAllKVs sr [] = return sr
addAllKVs sr (x : rest) = do
  sr' <- unsafePutKeyVal sr (byteString2NibbleString $ rlpSerialize $ rlpEncode $ fst x) (rlpEncode $ rlpSerialize $ rlpEncode $ snd x)
  addAllKVs sr' rest

-- ================================================================
-- Inclusion proofs (walk the caller's node store)
-- ================================================================

getInclusionProof ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  Key ->
  m (Maybe (B.ByteString, [B.ByteString]))
getInclusionProof rootSr key = do
  (mVal, proof) <- getProof rootSr key
  return $ (\val -> (rlpDecode val, proof)) <$> mVal

getProof ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  Key ->
  m (Maybe Val, [B.ByteString])
getProof rootSr key = walkRef (ptrRef rootSr) key []
  where
    walkRef (Right sr') k acc = do
      mNd <- A.lookup (Proxy @NodeData) sr'
      case mNd of
        Nothing -> return (Nothing, acc)
        Just nd ->
          walkNode nd k (acc ++ [rlpSerialize (rlpEncode nd)])
    walkRef (Left bytes) k acc =
      walkNode (rlpDecode (rlpDeserialize bytes) :: NodeData) k acc

    walkNode EmptyNodeData _ acc = return (Nothing, acc)
    walkNode (FullNodeData _ mVal) k acc
      | N.null k = return (mVal, acc)
    walkNode (FullNodeData cs _) k acc =
      let n = fromIntegral $ N.head k
       in walkRef (cs !! n) (N.tail k) acc
    walkNode (ShortcutNodeData s (Right val)) k acc
      | s == k = return (Just val, acc)
      | otherwise = return (Nothing, acc)
    walkNode (ShortcutNodeData s (Left ref)) k acc
      | s `N.isPrefixOf` k = walkRef ref (N.drop (N.length s) k) acc
      | otherwise = return (Nothing, acc)
