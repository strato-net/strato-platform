{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

-- | The state database as a composable monad layer: a Merkle Patricia trie
-- (key/value under a state root) over a node store. Code that reads or
-- writes a trie asks for 'HasStateDB'; providing a 'StateDBEnv' in the row
-- (and, for the root cursor, an @AccountDBEnv@) satisfies it. This is the
-- only module outside the trie library that sees trie nodes; the rest of the
-- code sees roots, keys and values.
module Control.Monad.Composable.StateDB
  ( StateDBEnv (..),
    StateDBM,
    HasStateDB,
    newStateDBEnv,
    runStateDBM,
    runStateDBOn,
    runStateDBAt,
    runMemStateDBM,
    sandboxStateDBEnv,
    tickNodeDB,
    flushNodeDB,

    -- * The trie
    MP.StateRoot (..),
    MP.emptyTriePtr,
    MP.blankStateRoot,
    MP.sha2StateRoot,
    MP.unboxStateRoot,
    MP.Key,
    MP.Val,
    keyToSafeKey,
    MP.getKeyVal,
    MP.putKeyVal,
    MP.putKeyValExisted,
    MP.deleteKey,
    MP.keyExists,
    MP.initializeBlank,
    unsafeGetAllKeyVals,
    unsafeGetKeyVals,
    forEachKeyVal,
    MP.getProof,
    MP.getInclusionProof,
    MP.addAllKVs,
    MP.runMP,
    MP.withSandbox,
    hasStateRoot,
    Diff.dbDiff,
    Diff.DiffOp (..),
    -- * Nodes, opaque; held and passed on by the peer protocol only
    TrieNode,
    withMissingNodeFetcher,
    lookupNode,
    insertNode,

    -- * Node stores
    NodeDB,
    NodeBytes,
    levelDBBytes,
    nodeDB,
    memoryNodeDB,
    cachedNodeDB,
  )
where

import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Diff as Diff
import Blockchain.Database.MerklePatricia (unsafeGetAllKeyVals)
import Blockchain.Database.MerklePatricia.Internal (keyToSafeKey, unsafeGetKeyVals)
import qualified Blockchain.Database.MerklePatricia.Map as Map
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Data.RLP (RLPObject)
import Blockchain.Strato.Model.Keccak256 (rlpHash)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Base
import Control.Monad.Composable.NodeDB (NodeBytes, NodeDB, fetchingNodeDB, levelDBBytes, memoryNodeDB, nodeDB, overlayNodeDB)
import qualified Control.Monad.Composable.NodeDB as N
import Control.Monad.Composable.NodeDB.Cached (cachedNodeDB)
import Control.Monad.IO.Class
import qualified Database.LevelDB as DB
import Data.Maybe (isJust)

-- | A trie node. Nothing outside this library looks inside one.
type TrieNode = MP.NodeData

newtype StateDBEnv = StateDBEnv {nodes :: NodeDB}

type StateDBM es = Eff (StateDBEnv ': es)

type HasStateDB m =
  ( (MP.StateRoot `A.Alters` TrieNode) m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m
  )

newStateDBEnv :: Applicative m => NodeDB -> m StateDBEnv
newStateDBEnv = pure . StateDBEnv

runStateDBM :: StateDBEnv -> StateDBM es a -> Eff es a
runStateDBM = provide

-- | Read a trie straight off a LevelDB handle (tools).
runStateDBOn :: MonadIO m => DB.DB -> StateDBM '[] a -> m a
runStateDBOn db m = do
  e <- newStateDBEnv (nodeDB (levelDBBytes db))
  liftIO . runEff $ runStateDBM e m

-- | Open the state database at @path@ and run the body over it. Trie nodes
-- live in LevelDB behind a cache of 20k parsed nodes (tens of MB) that
-- writes through every 256 blocks and when the body ends; a long-running
-- loop must 'flushNodeDB' before acknowledging input.
runStateDBAt :: FilePath -> DB.Options -> StateDBM es a -> Eff es a
runStateDBAt path opts m = do
  sdb <- liftIO $ MP.openMPDB path opts
  e <- newStateDBEnv =<< liftIO (cachedNodeDB 20000 256 (levelDBBytes (MP.unStateDB sdb)))
  runStateDBM e (m <* flushNodeDB)

-- | Trie nodes live in a map for the run (CLI, tests, tools).
runMemStateDBM :: StateDBM es a -> Eff es a
runMemStateDBM m = do
  e <- newStateDBEnv =<< liftIO memoryNodeDB
  runStateDBM e m

-- | The same store with writes held in an overlay: nothing done through it
-- reaches the store.
sandboxStateDBEnv :: MonadIO m => StateDBEnv -> m StateDBEnv
sandboxStateDBEnv e = liftIO $ StateDBEnv <$> overlayNodeDB (nodes e)

-- | Run the body with nodes the store lacks fetched by @fetch@ (from a peer)
-- and kept; used while comparing our state with a block's.
withMissingNodeFetcher :: forall es a. (StateDBEnv :> es) => (MP.StateRoot -> Eff es (Maybe TrieNode)) -> Eff es a -> Eff es a
withMissingNodeFetcher fetch m = Eff $ \outer ->
  unEff (localEnv @StateDBEnv (\e -> e {nodes = fetchingNodeDB (\k -> unEff (fetch k) outer) (nodes e)}) m) outer

lookupNode :: (MonadIO m, AccessibleEnv StateDBEnv m) => MP.StateRoot -> m (Maybe TrieNode)
lookupNode k = env $ \e -> N.lookupNode (nodes e) k

-- | Keep a node received from a peer; its hash is its key.
insertNode :: (MonadIO m, AccessibleEnv StateDBEnv m) => TrieNode -> m ()
insertNode nd = env $ \e -> N.insertNode (nodes e) (MP.sha2StateRoot $ rlpHash nd) nd

-- | Whether the trie at this root is in the store.
hasStateRoot :: (MP.StateRoot `A.Alters` TrieNode) m => MP.StateRoot -> m Bool
hasStateRoot sr = isJust <$> A.lookup (A.Proxy @TrieNode) sr

-- | Visit every key/value under a root.
forEachKeyVal :: (MP.StateRoot `A.Alters` TrieNode) m => (MP.Key -> RLPObject -> m ()) -> MP.StateRoot -> m ()
forEachKeyVal = Map.map

env :: (MonadIO m, AccessibleEnv StateDBEnv m) => (StateDBEnv -> IO a) -> m a
env f = accessEnv >>= liftIO . f

tickNodeDB, flushNodeDB :: (MonadIO m, AccessibleEnv StateDBEnv m) => m ()
tickNodeDB = env (N.tickNodes . nodes) >> MP.tick
flushNodeDB = env (N.flushNodes . nodes) >> MP.flush

instance (StateDBEnv :> es) => (MP.StateRoot `A.Alters` TrieNode) (Eff es) where
  lookup _ k = env $ \e -> N.lookupNode (nodes e) k
  insert _ k v = env $ \e -> N.insertNode (nodes e) k v
  delete _ k = env $ \e -> N.deleteNode (nodes e) k
