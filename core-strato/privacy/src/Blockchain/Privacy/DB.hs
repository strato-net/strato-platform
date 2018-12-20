{-# LANGUAGE FlexibleInstances      #-}
{-# LANGUAGE FunctionalDependencies #-}
{-# LANGUAGE LambdaCase             #-}
{-# LANGUAGE MultiParamTypeClasses  #-}
{-# LANGUAGE RecordWildCards        #-}
{-# LANGUAGE StrictData             #-}
{-# LANGUAGE TemplateHaskell        #-}

module Blockchain.Privacy.Monad where

import           Blockchain.Data.ChainInfo
import           Blockchain.ExtWord            (Word256)
import           Blockchain.SHA
import           Blockchain.Strato.Model.Class
import           Control.Lens
import           Control.Monad                 (join, void)
import           Control.Monad.Logger
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.State
import           Data.Function                 (on)
import           Data.Maybe                    (fromJust)
import qualified Data.Sequence                 as Q
import           Data.Set                      (Set)
import qualified Data.Set                      as S
import           Data.Traversable              (for)

data CircularBuffer a = CircularBuffer
  { _capacity :: Int
  , _size     :: Int
  , _queue    :: Q.Seq a
  } deriving (Show)
makeLenses ''CircularBuffer

maxBufferCapacity :: Int
maxBufferCapacity = 4096

emptyCircularBuffer :: CircularBuffer a
emptyCircularBuffer = CircularBuffer maxBufferCapacity 0 Q.empty

data ChainHashEntry = ChainHashEntry
  { _used         :: Bool
  , _onChainId    :: Maybe Word256
  , _inBlocks     :: Q.Seq SHA
  } deriving (Show)
makeLenses ''ChainHashEntry

chainHashEntryUsed :: ChainHashEntry
chainHashEntryUsed = ChainHashEntry True Nothing Q.empty

chainHashEntryWithChainId :: Word256 -> ChainHashEntry
chainHashEntryWithChainId chainId = ChainHashEntry False (Just chainId) Q.empty

chainHashEntryInBlock :: SHA -> ChainHashEntry
chainHashEntryInBlock bHash = ChainHashEntry True Nothing (Q.singleton bHash)

data BlockInfo = BlockInfo
  { _bhash     :: SHA
  , _bordering :: Integer
  } deriving (Eq, Show)
makeLenses ''BlockInfo

instance Ord BlockInfo where
  compare = compare `on` _bordering

data ChainIdEntry = ChainIdEntry
  { _chainIdInfo :: ChainInfo
  , _chainHashes :: CircularBuffer SHA
  , _blocksToRun :: Set BlockInfo
  } deriving (Show)
makeLenses ''ChainIdEntry

chainIdEntry :: ChainInfo -> ChainIdEntry
chainIdEntry cInfo = ChainIdEntry cInfo emptyCircularBuffer S.empty

class (BlockLike h t b, MonadResource m, MonadLogger m) => HasPrivateHashDB h t b m | m -> h t b where
  getChainId               :: ChainInfo -> m SHA
  generateInitialChainHash :: ChainInfo -> m SHA
  generateChainHashes      :: TransactionLike t => t -> m [SHA]
  requestTransaction       :: SHA -> m ()
  requestChain             :: Word256 -> m ()
  alterBlockHashEntry      :: BlockLike h t b => SHA -> (Maybe b -> m (Maybe b)) -> m (Maybe b)
  alterTxHashEntry         :: TransactionLike t => SHA -> (Maybe t -> m (Maybe t)) -> m (Maybe t)
  alterChainHashEntry      :: SHA -> (Maybe ChainHashEntry -> m (Maybe ChainHashEntry)) -> m (Maybe ChainHashEntry)
  alterChainIdEntry        :: Word256 -> (Maybe ChainIdEntry -> m (Maybe ChainIdEntry)) -> m (Maybe ChainIdEntry)

ffor :: (Applicative f, Monad t, Traversable t) => t a -> (a -> f (t b)) -> f (t b)
ffor t = fmap join . for t

{-
  GUIDE:
  All the following functions follow this pattern, for key type K and value type V:
  - alterX takes a K, a function (Maybe V -> m (Maybe V)), and returns m (Maybe V)
    - similar to Map.alter, which reads a (maybe non-existent) value from the Map,
      then either inserts, updates, or deletes it.
    - if the input value is Nothing, the value doesn't exist in the Map.
    - if the return value is Nothing, the (k,v) pair is deleted from the Map.
  - updateX takes a K, a function (V -> m (Maybe V)), and returns m (Maybe V)
    - similar to Map.update, which takes an existing value for the Map, and either
      updates or deletes it.
    - if the return value is Nothing, the (k,v) pair is deleted from the Map.
    - if the (k,v) pair is not in the Map, the function is not applied.
  - modifyX takes a K, a function (V -> m V), and returns m V.
    - similar to State.modify
    - takes an existing v from the Map, and modifies it with f.
    - cannot be used to insert or delete items from the Map
    - if the (k,v) pair is not in the Map, the function is not applied.
  - repsertX takes a K, a function (Maybe V -> m V), and returns m V.
    - can be used to insert, modify, or overwrite an existing element of the Map.
    - cannot be used to delete an item from the Map
  - insertX takes a K, a V, and returns m ()
  - getX takes a K, returns m (Maybe V)
  - updateXState takes a K, a StateT V m (Maybe V) action, and returns m (Maybe V)
    - same as updateX, but run in the StateT monad
    - allows for nicer lens operations, and implicit state updates
    - if the return value of the action is Nothing, the item is deleted from the Map
    - uses evalStateT
  - modifyXState takes a K, a StateT V m () action, and returns m V.
    - same as modifyX, but run in the StateT monad
    - allows for nicer lens operations, and implicit state updates
    - action has no return value (m ())
    - uses execStateT
  - quiet versions of each function had an underscore appended (e.g. alterX_, modifyXState_)
-}

insertBlockHashEntry :: HasPrivateHashDB h t b m => SHA -> b -> m ()
insertBlockHashEntry bHash bhe = void $ alterBlockHashEntry bHash (return . const (Just bhe))

getBlockHashEntry :: HasPrivateHashDB h t b m => SHA -> m (Maybe b)
getBlockHashEntry bHash = alterBlockHashEntry bHash return

insertTxHashEntry :: HasPrivateHashDB h t b m => SHA -> t -> m ()
insertTxHashEntry tHash the = void $ alterTxHashEntry tHash (return . const (Just the))

getTxHashEntry :: HasPrivateHashDB h t b m => SHA -> m (Maybe t)
getTxHashEntry tHash = alterTxHashEntry tHash return

updateChainHashEntry :: HasPrivateHashDB h t b m => SHA -> (ChainHashEntry -> m (Maybe ChainHashEntry)) -> m (Maybe ChainHashEntry)
updateChainHashEntry cHash = alterChainHashEntry cHash . flip ffor

updateChainHashEntryState :: HasPrivateHashDB h t b m => SHA -> StateT ChainHashEntry m (Maybe ChainHashEntry) -> m (Maybe ChainHashEntry)
updateChainHashEntryState cHash = updateChainHashEntry cHash . evalStateT

modifyChainHashEntry :: HasPrivateHashDB h t b m => SHA -> (ChainHashEntry -> m ChainHashEntry) -> m ChainHashEntry
modifyChainHashEntry cHash f = fmap fromJust $ updateChainHashEntry cHash (fmap Just . f)

modifyChainHashEntryState :: HasPrivateHashDB h t b m => SHA -> StateT ChainHashEntry m () -> m ChainHashEntry
modifyChainHashEntryState cHash = modifyChainHashEntry cHash . execStateT

repsertChainHashEntry :: HasPrivateHashDB h t b m => SHA -> (Maybe ChainHashEntry -> m ChainHashEntry) -> m ChainHashEntry
repsertChainHashEntry cHash f = fmap fromJust $ alterChainHashEntry cHash (fmap Just . f)

insertChainHashEntry :: HasPrivateHashDB h t b m => SHA -> ChainHashEntry -> m ()
insertChainHashEntry cHash che = alterChainHashEntry_ cHash (return . const (Just che))

getChainHashEntry :: HasPrivateHashDB h t b m => SHA -> m (Maybe ChainHashEntry)
getChainHashEntry cHash = alterChainHashEntry cHash return

alterChainHashEntry_ :: HasPrivateHashDB h t b m => SHA -> (Maybe ChainHashEntry -> m (Maybe ChainHashEntry)) -> m ()
alterChainHashEntry_ cHash = void . alterChainHashEntry cHash

updateChainHashEntry_ :: HasPrivateHashDB h t b m => SHA -> (ChainHashEntry -> m (Maybe ChainHashEntry)) -> m ()
updateChainHashEntry_ cHash = void . updateChainHashEntry cHash

updateChainHashEntryState_ :: HasPrivateHashDB h t b m => SHA -> StateT ChainHashEntry m (Maybe ChainHashEntry) -> m ()
updateChainHashEntryState_ cHash = void . updateChainHashEntryState cHash

modifyChainHashEntry_ :: HasPrivateHashDB h t b m => SHA -> (ChainHashEntry -> m ChainHashEntry) -> m ()
modifyChainHashEntry_ cHash = void . modifyChainHashEntry cHash

modifyChainHashEntryState_ :: HasPrivateHashDB h t b m => SHA -> StateT ChainHashEntry m () -> m ()
modifyChainHashEntryState_ cHash = void . modifyChainHashEntryState cHash

repsertChainHashEntry_ :: HasPrivateHashDB h t b m => SHA -> (Maybe ChainHashEntry -> m ChainHashEntry) -> m ()
repsertChainHashEntry_ cHash = void . repsertChainHashEntry cHash

updateChainIdEntry :: HasPrivateHashDB h t b m => Word256 -> (ChainIdEntry -> m (Maybe ChainIdEntry)) -> m (Maybe ChainIdEntry)
updateChainIdEntry cId = alterChainIdEntry cId . flip ffor

updateChainIdEntryState :: HasPrivateHashDB h t b m => Word256 -> StateT ChainIdEntry m (Maybe ChainIdEntry) -> m (Maybe ChainIdEntry)
updateChainIdEntryState cId = updateChainIdEntry cId . evalStateT

modifyChainIdEntry :: HasPrivateHashDB h t b m => Word256 -> (ChainIdEntry -> m ChainIdEntry) -> m ChainIdEntry
modifyChainIdEntry cId f = fmap fromJust $ updateChainIdEntry cId (fmap Just . f)

modifyChainIdEntryState :: HasPrivateHashDB h t b m => Word256 -> StateT ChainIdEntry m () -> m ChainIdEntry
modifyChainIdEntryState cId = modifyChainIdEntry cId . execStateT

repsertChainIdEntry :: HasPrivateHashDB h t b m => Word256 -> (Maybe ChainIdEntry -> m ChainIdEntry) -> m ChainIdEntry
repsertChainIdEntry cId f = fmap fromJust $ alterChainIdEntry cId (fmap Just . f)

insertChainIdEntry :: HasPrivateHashDB h t b m => Word256 -> ChainIdEntry -> m ()
insertChainIdEntry cId cie = alterChainIdEntry_ cId (return . const (Just cie))

getChainIdEntry :: HasPrivateHashDB h t b m => Word256 -> m (Maybe ChainIdEntry)
getChainIdEntry cId = alterChainIdEntry cId return

alterChainIdEntry_ :: HasPrivateHashDB h t b m => Word256 -> (Maybe ChainIdEntry -> m (Maybe ChainIdEntry)) -> m ()
alterChainIdEntry_ cId = void . alterChainIdEntry cId

updateChainIdEntry_ :: HasPrivateHashDB h t b m => Word256 -> (ChainIdEntry -> m (Maybe ChainIdEntry)) -> m ()
updateChainIdEntry_ cId = void . updateChainIdEntry cId

updateChainIdEntryState_ :: HasPrivateHashDB h t b m => Word256 -> StateT ChainIdEntry m (Maybe ChainIdEntry) -> m ()
updateChainIdEntryState_ cId = void . updateChainIdEntryState cId

modifyChainIdEntry_ :: HasPrivateHashDB h t b m => Word256 -> (ChainIdEntry -> m ChainIdEntry) -> m ()
modifyChainIdEntry_ cId = void . modifyChainIdEntry cId

modifyChainIdEntryState_ :: HasPrivateHashDB h t b m => Word256 -> StateT ChainIdEntry m () -> m ()
modifyChainIdEntryState_ cId = void . modifyChainIdEntryState cId

repsertChainIdEntry_ :: HasPrivateHashDB h t b m => Word256 -> (Maybe ChainIdEntry -> m ChainIdEntry) -> m ()
repsertChainIdEntry_ cId = void . repsertChainIdEntry cId
