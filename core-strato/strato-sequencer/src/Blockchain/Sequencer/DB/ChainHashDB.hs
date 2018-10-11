
module Blockchain.Sequencer.DB.ChainHashDB where

import           Blockchain.ExtWord           (Word256)
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.RLP
import           Blockchain.SHA

import           Control.Monad.IO.Class
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import qualified Data.Sequence                as Q
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.SeenChainDB
import           Blockchain.Sequencer.DB.Metrics

getChainHashMap :: HasPrivateHashDB m => m (Map SHA (Bool, Word256))
getChainHashMap = chainHashMap <$> getPrivateHashDB

putChainHashMap :: HasPrivateHashDB m => Map SHA (Bool, Word256) -> m ()
putChainHashMap m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ chainHashMap = m }

lookupChainHash :: HasPrivateHashDB m => SHA -> m (Maybe (Bool, Word256))
lookupChainHash h = M.lookup h <$> getChainHashMap

insertChainHash :: HasPrivateHashDB m => SHA -> Word256 -> m ()
insertChainHash h cid = do
  liftIO $ withLabel "chain_hash" incCounter chainMetrics
  getChainHashMap >>= putChainHashMap . M.insert h (False, cid)

useChainHash :: HasPrivateHashDB m => SHA -> Word256 -> m ()
useChainHash h cid = getChainHashMap >>= putChainHashMap . M.alter (\_ -> Just (True, cid)) h

getChainBuffers :: HasPrivateHashDB m => m (Map Word256 (CircularBuffer SHA))
getChainBuffers = chainBuffers <$> getPrivateHashDB

putChainBuffers :: HasPrivateHashDB m => Map Word256 (CircularBuffer SHA) -> m ()
putChainBuffers m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ chainBuffers = m }

lookupChainBuffer :: HasPrivateHashDB m => Word256 -> m (CircularBuffer SHA)
lookupChainBuffer cid = maybe emptyCircularBuffer id . M.lookup cid <$> getChainBuffers

insertChainBuffer :: HasPrivateHashDB m => Word256 -> CircularBuffer SHA -> m ()
insertChainBuffer cid buf = getChainBuffers >>= putChainBuffers . M.insert cid buf

createChainBuffer :: HasPrivateHashDB m => Word256 -> m ()
createChainBuffer = flip insertChainBuffer emptyCircularBuffer

insertChainBufferEntry :: HasPrivateHashDB m => Word256 -> SHA -> m ()
insertChainBufferEntry cid h = do
  CircularBuffer cap sz q <- lookupChainBuffer cid
  let cb = if sz < cap
             then CircularBuffer cap (sz + 1) (q Q.|> h)
             else case Q.viewl q of
                    Q.EmptyL -> CircularBuffer cap 1 (q Q.|> h)
                    (_ Q.:< q') -> CircularBuffer cap sz (q' Q.|> h)
  liftIO $ withLabel (show cid) (setGauge (fromIntegral sz)) chainBuffer
  insertChainBuffer cid cb

getChainHash :: HasPrivateHashDB m => Word256 -> m SHA
getChainHash cid = do
  CircularBuffer cap sz q <- lookupChainBuffer cid
  case Q.viewl q of
    Q.EmptyL -> error $ "getChainHash: Empty chain buffer for chainId " ++ show cid
    (h Q.:< q') -> do
      insertChainBuffer cid (CircularBuffer cap (sz - 1) q')
      Just (used, _) <- lookupChainHash h
      if not used
        then useChainHash h cid >> return h
        else getChainHash cid

insertChainInfo :: HasPrivateHashDB m => Word256 -> ChainInfo -> m ()
insertChainInfo cId cInfo = do
  let h = hash . rlpSerialize $ rlpEncode cInfo
  insertSeenChain cId
  insertChainHash h cId
  insertChainBufferEntry cId h
