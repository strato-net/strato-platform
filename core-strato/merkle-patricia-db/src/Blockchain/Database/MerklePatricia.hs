{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeOperators         #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}

-- | This is an implementation of the modified Merkle Patricia database
-- described in the Ethereum Yellowpaper
-- (<http://gavwood.com/paper.pdf>).  This modified version works like a
-- canonical Merkle Patricia database, but includes certain
-- optimizations.  In particular, a new type of "shortcut node" has been
-- added to represent multiple traditional nodes that fall in a linear
-- string (ie- a stretch of parent child nodes where no branch choices
-- exist).
--
-- A Merkle Patricia Database effeciently retains its full history, and a
-- snapshot of all key-value pairs at a given time can be looked up using
-- a "stateRoot" (a pointer to the root of the tree representing that
-- data).  Many of the functions in this module work by updating this
-- object, so for anything more complicated than a single update, use of
-- the state monad is recommended.
--
-- The underlying data is actually stored in LevelDB.  This module
-- provides the logic to organize the key-value pairs in the appropriate
-- Patricia Merkle Tree.

module Blockchain.Database.MerklePatricia (
  genericOutputsStringIO,
  genericLookupDB, genericInsertDB, genericDeleteDB,
  Key, Val, MPDB(..), StateRoot(..), NodeData(..),
  openMPDB, emptyTriePtr, sha2StateRoot, unboxStateRoot,
  putKeyVal, getKeyVal, deleteKey, keyExists,
  initializeBlank, blankStateRoot
  ) where

import           Control.Monad.Change.Alter
import           Control.Monad.Change.Modify
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import qualified Data.ByteString                             as B
import           Data.Default
import           Data.Maybe                                  (isJust, listToMaybe)
import qualified Database.LevelDB                            as DB

import           Blockchain.Data.RLP
import           Blockchain.Database.MerklePatricia.Internal
import           Blockchain.Strato.Model.SHA                 (keccak256)

genericOutputsStringIO :: MonadIO m => String -> m ()
genericOutputsStringIO = liftIO . putStrLn

instance IO `Outputs` String where
  output = genericOutputsStringIO

instance (ReaderT DB.DB IO) `Outputs` String where
  output = genericOutputsStringIO

genericLookupDB :: MonadIO m => m DB.DB -> StateRoot -> m (Maybe NodeData)
genericLookupDB f (StateRoot sr) = do
  db <- f
  fmap bytes2NodeData <$> DB.get db def sr
  where bytes2NodeData :: B.ByteString -> NodeData
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

-- | Adds a new key/value pair.
putKeyVal :: (StateRoot `Alters` NodeData) m
          => StateRoot -- ^ The object containing the current stateRoot.
          -> Key -- ^ Key of the data to be inserted.
          -> Val -- ^ Value of the new data
          -> m StateRoot -- ^ The object containing the stateRoot to the data after the insert.
putKeyVal sr = unsafePutKeyVal sr . keyToSafeKey

-- | Retrieves all key/value pairs whose key starts with the given parameter.
getKeyVal :: (StateRoot `Alters` NodeData) m
          => StateRoot -- ^ Object containing the current stateRoot.
          -> Key -- ^ Key of the data to be inserted.
          -> m (Maybe Val) -- ^ The requested value.
getKeyVal sr key = fmap snd . listToMaybe <$> unsafeGetKeyVals sr (keyToSafeKey key)

-- | Deletes a key (and its corresponding data) from the database.
--
-- Note that the key/value pair will still be present in the history, and
-- can be accessed by using an older 'MPDB' object.
deleteKey :: (StateRoot `Alters` NodeData) m
          => StateRoot -- ^ The object containing the current stateRoot.
          -> Key -- ^ The key to be deleted.
          -> m StateRoot -- ^ The object containing the stateRoot to the data after the delete.
deleteKey sr = unsafeDeleteKey sr . keyToSafeKey

-- | Returns True is a key exists.
keyExists :: (StateRoot `Alters` NodeData) m
          => StateRoot -- ^ The object containing the current stateRoot.
          -> Key -- ^ The key to be deleted.
          -> m Bool -- ^ True if the key exists
keyExists sr key = isJust <$> getKeyVal sr key

-- | Returns the StateRoot of the blank database
blankStateRoot :: StateRoot
blankStateRoot = StateRoot $ keccak256 (rlpSerialize $ rlpEncode (0 :: Integer))

-- | Initialize the DB by adding a blank stateroot.
initializeBlank :: (StateRoot `Alters` NodeData) m
                => m ()
initializeBlank =
    let bytes = rlpSerialize $ rlpEncode EmptyNodeData
    in insert Proxy (StateRoot (keccak256 bytes)) EmptyNodeData
