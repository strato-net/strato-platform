-- | A 'NodeDB' that keeps parsed nodes in memory and holds writes back.
--
-- Reads hit the cache, then the raw store; writes are batched and written
-- through on 'tickNodes' every @flushEvery@ blocks (or on 'flushNodes').
-- Node bytes are copied into arena slabs so the cache never pins LevelDB's
-- read buffers; see "KV.Cache".
module Control.Monad.Composable.NodeDB.Cached
  ( cachedNodeDB,
  )
where

import Blockchain.Data.RLP (RLPObject (..))
import qualified Blockchain.Database.MerklePatricia as MP
import Control.Monad.Composable.NodeDB
import qualified Data.ByteString as B
import qualified KV.Cache

-- | @cachedNodeDB capacity flushEvery raw@: up to @capacity@ parsed nodes,
-- written through every @flushEvery@ ticks.
cachedNodeDB :: Int -> Int -> NodeBytes -> IO NodeDB
cachedNodeDB capacity flushEvery raw = do
  cache <-
    KV.Cache.new
      KV.Cache.Config
        { KV.Cache.capacity = capacity,
          KV.Cache.slabBytes = 65536,
          KV.Cache.flushEvery = flushEvery,
          KV.Cache.encode = encodeNode,
          KV.Cache.decode = decodeNode
        }
  pure
    NodeDB
      { lookupNode = \(MP.StateRoot k) -> fmap ownVal <$> KV.Cache.lookup cache k (lookupBytes raw k),
        insertNode = \(MP.StateRoot k) nd -> KV.Cache.insert cache k nd,
        deleteNode = \(MP.StateRoot k) -> KV.Cache.delete cache k >> deleteBytes raw k,
        tickNodes = KV.Cache.tick cache (writeBytes raw),
        flushNodes = KV.Cache.flush cache (writeBytes raw),
        discardNodes = KV.Cache.discard cache
      }

-- | Leaf values escape into long-lived block maps; give them their own bytes so a
-- retained account or storage slot does not keep a whole arena slab alive.
ownVal :: MP.NodeData -> MP.NodeData
ownVal (MP.ShortcutNodeData k (Right v)) = MP.ShortcutNodeData k (Right (copyRLP v))
ownVal (MP.FullNodeData cs (Just v)) = MP.FullNodeData cs (Just (copyRLP v))
ownVal nd = nd

copyRLP :: RLPObject -> RLPObject
copyRLP (RLPString bs) = RLPString (B.copy bs)
copyRLP (RLPArray xs) = RLPArray (map copyRLP xs)
copyRLP o = o
