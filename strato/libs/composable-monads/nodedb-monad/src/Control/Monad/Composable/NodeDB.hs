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
-- be layered: an overlay over LevelDB for sandboxed calls, or a cache over the
-- raw bytes ('Control.Monad.Composable.NodeDB.Cached').
module Control.Monad.Composable.NodeDB
  ( NodeDB (..),
    NodeDBM,
    HasNodeDB,
    runNodeDBM,
    tickNodeDB,
    flushNodeDB,
    NodeBytes (..),
    levelDBBytes,
    nodeDB,
    encodeNode,
    decodeNode,
    mapNodeDB,
    overlayNodeDB,
  )
where

import Blockchain.Data.RLP (rlpDecode, rlpDeserialize, rlpEncode, rlpSerialize)
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Base
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import Data.Default (def)
import Data.IORef
import qualified Data.Map as M
import qualified Database.LevelDB as DB

data NodeDB = NodeDB
  { lookupNode :: MP.StateRoot -> IO (Maybe MP.NodeData),
    insertNode :: MP.StateRoot -> MP.NodeData -> IO (),
    deleteNode :: MP.StateRoot -> IO (),
    -- | A block is done; a store holding writes back may write them through.
    tickNodes :: IO (),
    -- | Write everything held back, now.
    flushNodes :: IO ()
  }

type NodeDBM es = Eff (NodeDB ': es)

type HasNodeDB m = (MonadIO m, AccessibleEnv NodeDB m)

runNodeDBM :: NodeDB -> NodeDBM es a -> Eff es a
runNodeDBM = provide

tickNodeDB, flushNodeDB :: HasNodeDB m => m ()
tickNodeDB = accessEnv >>= liftIO . tickNodes
flushNodeDB = accessEnv >>= liftIO . flushNodes

instance (NodeDB :> es) => (MP.StateRoot `A.Alters` MP.NodeData) (Eff es) where
  lookup _ k = accessEnv >>= \db -> liftIO (lookupNode db k)
  insert _ k v = accessEnv >>= \db -> liftIO (insertNode db k v)
  delete _ k = accessEnv >>= \db -> liftIO (deleteNode db k)

-- | Raw node bytes by hash, as LevelDB holds them.
data NodeBytes = NodeBytes
  { lookupBytes :: B.ByteString -> IO (Maybe B.ByteString),
    writeBytes :: [(B.ByteString, B.ByteString)] -> IO (),
    deleteBytes :: B.ByteString -> IO ()
  }

levelDBBytes :: DB.DB -> NodeBytes
levelDBBytes db =
  NodeBytes
    { lookupBytes = DB.get db def,
      writeBytes = \kvs -> DB.write db def [DB.Put k v | (k, v) <- kvs],
      deleteBytes = DB.delete db def
    }

-- | The RLP codec over a raw store; every write goes straight through.
nodeDB :: NodeBytes -> NodeDB
nodeDB raw =
  NodeDB
    { lookupNode = \(MP.StateRoot k) -> fmap decodeNode <$> lookupBytes raw k,
      insertNode = \(MP.StateRoot k) nd -> writeBytes raw [(k, encodeNode nd)],
      deleteNode = \(MP.StateRoot k) -> deleteBytes raw k,
      tickNodes = pure (),
      flushNodes = pure ()
    }

encodeNode :: MP.NodeData -> B.ByteString
encodeNode = rlpSerialize . rlpEncode

decodeNode :: B.ByteString -> MP.NodeData
decodeNode bs
  | B.null bs = MP.EmptyNodeData
  | otherwise = rlpDecode (rlpDeserialize bs)

-- | Every node in a map; the whole store for in-memory runs.
mapNodeDB :: IORef (M.Map MP.StateRoot MP.NodeData) -> NodeDB
mapNodeDB ref =
  NodeDB
    { lookupNode = \k -> M.lookup k <$> readIORef ref,
      insertNode = \k v -> modifyIORef' ref (M.insert k v),
      deleteNode = \k -> modifyIORef' ref (M.delete k),
      tickNodes = pure (),
      flushNodes = pure ()
    }

-- | Writes stay in the overlay; a read misses through to the inner store.
overlayNodeDB :: IORef (M.Map MP.StateRoot MP.NodeData) -> NodeDB -> NodeDB
overlayNodeDB ref inner =
  (mapNodeDB ref)
    { lookupNode = \k -> M.lookup k <$> readIORef ref >>= maybe (lookupNode inner k) (pure . Just)
    }
