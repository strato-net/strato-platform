{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeOperators #-}

-- | The trie node store as a composable monad layer.
--
-- Trie code asks only for @StateRoot `Alters` NodeData@; providing a 'NodeDB'
-- in the row satisfies it. A 'NodeDB' is a record of actions, so stores can
-- be layered: an overlay over LevelDB for sandboxed calls, or a cache over either.
module Control.Monad.Composable.NodeDB
  ( NodeDB (..),
    NodeDBM,
    HasNodeDB,
    runNodeDBM,
    levelDBNodeDB,
    mapNodeDB,
    overlayNodeDB,
  )
where

import qualified Blockchain.Database.MerklePatricia as MP
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Base
import Control.Monad.IO.Class
import Data.IORef
import qualified Data.Map as M
import qualified Database.LevelDB as DB

data NodeDB = NodeDB
  { lookupNode :: MP.StateRoot -> IO (Maybe MP.NodeData),
    insertNode :: MP.StateRoot -> MP.NodeData -> IO (),
    deleteNode :: MP.StateRoot -> IO ()
  }

type NodeDBM es = Eff (NodeDB ': es)

type HasNodeDB m = (MonadIO m, AccessibleEnv NodeDB m)

runNodeDBM :: NodeDB -> NodeDBM es a -> Eff es a
runNodeDBM = provide

instance (NodeDB :> es) => (MP.StateRoot `A.Alters` MP.NodeData) (Eff es) where
  lookup _ k = accessEnv >>= \db -> liftIO (lookupNode db k)
  insert _ k v = accessEnv >>= \db -> liftIO (insertNode db k v)
  delete _ k = accessEnv >>= \db -> liftIO (deleteNode db k)

levelDBNodeDB :: DB.DB -> NodeDB
levelDBNodeDB db =
  NodeDB
    { lookupNode = MP.genericLookupDB (pure db),
      insertNode = MP.genericInsertDB (pure db),
      deleteNode = MP.genericDeleteDB (pure db)
    }

-- | Every node in a map; the whole store for in-memory runs.
mapNodeDB :: IORef (M.Map MP.StateRoot MP.NodeData) -> NodeDB
mapNodeDB ref =
  NodeDB
    { lookupNode = \k -> M.lookup k <$> readIORef ref,
      insertNode = \k v -> modifyIORef' ref (M.insert k v),
      deleteNode = \k -> modifyIORef' ref (M.delete k)
    }

-- | Writes stay in the overlay; a read misses through to the inner store.
overlayNodeDB :: IORef (M.Map MP.StateRoot MP.NodeData) -> NodeDB -> NodeDB
overlayNodeDB ref inner =
  (mapNodeDB ref)
    { lookupNode = \k -> M.lookup k <$> readIORef ref >>= maybe (lookupNode inner k) (pure . Just)
    }
