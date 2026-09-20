{-# OPTIONS -fno-warn-redundant-constraints #-}
-- todo fixme
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.DB.MemAddressStateDB
  ( MemAddressStateDB (..),
    runNewMemAddressStateDB,
    HasMemAddressStateDB (..),
    AddressStateModification (..),
    BlockMap (..),
    emptyBlockMap,
    lookupBlockMap,
    insertReadBlockMap,
    insertBlockMap,
    insertManyBlockMap,
    deleteBlockMap,
    dirtyBlockMap,
    getAddressStateMaybe,
    putAddressState,
    putAddressStates,
    resetAddressStateTxDBMap,
    flushMemAddressStateDB,
    deleteAddressState,
    deleteAddressStates,
  )
where

import qualified Blockchain.DB.AddressStateDB as DB
import BlockApps.Logging (MonadLogger)
import Blockchain.DB.HashDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Strato.Model.Address
import Control.DeepSeq
import Data.Binary
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class
import Control.Monad.Trans.Class
import Control.Monad.Trans.State.Strict
import qualified Data.HashMap.Strict as HM
import qualified Data.HashSet as HS
import Data.Hashable (Hashable)
import qualified Data.List as L
import qualified Data.Map as M
import GHC.Generics
import Text.Format

newtype MemAddressStateDB m a = MemAddressStateDB {unMemAddressStateDB :: StateT (M.Map Address AddressState) m a}
  deriving (Functor, Applicative, Monad, MonadIO)

instance MonadTrans MemAddressStateDB where
  lift = MemAddressStateDB . lift

instance Monad m => (Address `A.Alters` AddressState) (MemAddressStateDB m) where
  lookup _ = MemAddressStateDB . gets . M.lookup
  insert _ k = MemAddressStateDB . modify' . M.insert k
  delete _ = MemAddressStateDB . modify' . M.delete

instance {-# OVERLAPPING #-} Monad m => A.Selectable Address AddressState (MemAddressStateDB m) where
  select = A.lookup

runMemAddressStateDB :: Monad m => MemAddressStateDB m a -> M.Map Address AddressState -> m a
runMemAddressStateDB f m = evalStateT (unMemAddressStateDB f) m

runNewMemAddressStateDB :: Monad m => MemAddressStateDB m a -> m a
runNewMemAddressStateDB f = runMemAddressStateDB f M.empty

data AddressStateModification = ASModification AddressState | ASDeleted deriving (Show, Eq, Generic)

instance NFData AddressStateModification

instance Binary AddressStateModification

instance Format AddressStateModification where
  format (ASModification addressState) = "Address Modified:\n" ++ format addressState
  format ASDeleted = "Address Deleted"

-- | The block-level flush map: everything known about a key (read from the trie,
-- including that the trie has no value for it, or written by a transaction),
-- plus the keys written since the last flush.  A flush touches only the dirty
-- keys instead of scanning the whole map (which is retained across blocks).
data BlockMap k v = BlockMap
  { -- | @Nothing@ records that the trie was read and has no value for the key.
    bmEntries :: !(HM.HashMap k (Maybe v)),
    bmDirty :: !(HS.HashSet k)
  }
  deriving (Show, Generic)

instance (NFData k, NFData v) => NFData (BlockMap k v)

emptyBlockMap :: BlockMap k v
emptyBlockMap = BlockMap HM.empty HS.empty

-- | @Nothing@: not known, read the trie.  @Just Nothing@: known absent.
lookupBlockMap :: (Eq k, Hashable k) => k -> BlockMap k v -> Maybe (Maybe v)
lookupBlockMap k = HM.lookup k . bmEntries

-- | Remember what the trie returned for a key (a value, or nothing).
insertReadBlockMap :: (Eq k, Hashable k) => k -> Maybe v -> BlockMap k v -> BlockMap k v
insertReadBlockMap k v bm = bm {bmEntries = HM.insert k v (bmEntries bm)}

-- | Write a value; it is flushed to the trie at the end of the block.
insertBlockMap :: (Eq k, Hashable k) => k -> v -> BlockMap k v -> BlockMap k v
insertBlockMap k v (BlockMap entries dirty) = BlockMap (HM.insert k (Just v) entries) (HS.insert k dirty)

insertManyBlockMap :: (Eq k, Hashable k) => M.Map k v -> BlockMap k v -> BlockMap k v
insertManyBlockMap kvs (BlockMap entries dirty) =
  BlockMap
    (L.foldl' (\acc (k, v) -> HM.insert k (Just v) acc) entries (M.toList kvs))
    (L.foldl' (flip HS.insert) dirty (M.keys kvs))

-- | Forget a key; reads fall through to the trie again.
deleteBlockMap :: (Eq k, Hashable k) => k -> BlockMap k v -> BlockMap k v
deleteBlockMap k (BlockMap entries dirty) = BlockMap (HM.delete k entries) (HS.delete k dirty)

-- | This block's writes, in flush order.
dirtyBlockMap :: (Eq k, Hashable k) => BlockMap k v -> [(k, v)]
dirtyBlockMap (BlockMap entries dirty) = [(k, v) | k <- HS.toList dirty, Just (Just v) <- [HM.lookup k entries]]

class HasMemAddressStateDB m where
  -- | Accounts modified by the current transaction.  Only feeds the per-tx
  -- TransactionResult (contracts created/deleted); reads never consult it.
  getAddressStateTxDBMap :: m (M.Map Address AddressStateModification)
  putAddressStateTxDBMap :: M.Map Address AddressStateModification -> m ()
  getAddressStateBlockDBMap :: m (BlockMap Address AddressStateModification)
  putAddressStateBlockDBMap :: BlockMap Address AddressStateModification -> m ()

getAddressStateMaybe ::
  (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  Address ->
  m (Maybe AddressState)
getAddressStateMaybe address = do
  theBMap <- getAddressStateBlockDBMap
  case lookupBlockMap address theBMap of
    Just (Just (ASModification addressState)) -> return $ Just addressState
    Just (Just ASDeleted) -> return $ Just blankAddressState
    _ -> do
      result <- DB.getAddressStateMaybe address
      forM_ result $ \addressState ->
        putAddressStateBlockDBMap $ insertReadBlockMap address (Just (ASModification addressState)) theBMap
      return result

putAddressStateModification ::
  (Monad m, HasMemAddressStateDB m) =>
  Address ->
  AddressStateModification ->
  m ()
putAddressStateModification address m = do
  putAddressStateBlockDBMap . insertBlockMap address m =<< getAddressStateBlockDBMap
  putAddressStateTxDBMap . M.insert address m =<< getAddressStateTxDBMap

putAddressState ::
  (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  Address ->
  AddressState ->
  m ()
putAddressState address = putAddressStateModification address . ASModification

putAddressStates ::
  (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  M.Map Address AddressStateModification ->
  m ()
putAddressStates localMap = do
  putAddressStateBlockDBMap . insertManyBlockMap localMap =<< getAddressStateBlockDBMap
  putAddressStateTxDBMap . M.union localMap =<< getAddressStateTxDBMap

-- | Start a new transaction's record of modified accounts.
resetAddressStateTxDBMap :: (Monad m, HasMemAddressStateDB m) => m ()
resetAddressStateTxDBMap = putAddressStateTxDBMap M.empty

flushMemAddressStateDB ::
  (MonadLogger m, HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
  m ()
flushMemAddressStateDB = do
  bm <- getAddressStateBlockDBMap
  let dirtyEntries = dirtyBlockMap bm
  DB.putAddressStates [(address, addressState) | (address, ASModification addressState) <- dirtyEntries]
  forM_ [address | (address, ASDeleted) <- dirtyEntries] DB.deleteAddressState
  -- Flushed entries stay in the block map as reads (deleted accounts drop out);
  -- the map is cleared per input batch and whenever the state root diverges (addBlock).
  let dropDeleted (address, ASDeleted) = HM.delete address
      dropDeleted _ = id
  putAddressStateBlockDBMap $ BlockMap (foldr dropDeleted (bmEntries bm) dirtyEntries) HS.empty

deleteAddressState ::
  (HasMemAddressStateDB m, HasStateDB m) =>
  Address ->
  m ()
deleteAddressState address = putAddressStateModification address ASDeleted

deleteAddressStates ::
  (HasMemAddressStateDB m, HasStateDB m) =>
  [Address] ->
  m ()
deleteAddressStates addresses = do
  putAddressStateBlockDBMap . flip (foldr deleteBlockMap) addresses =<< getAddressStateBlockDBMap
  putAddressStateTxDBMap . flip M.difference (M.fromList $ (,ASDeleted) <$> addresses) =<< getAddressStateTxDBMap
