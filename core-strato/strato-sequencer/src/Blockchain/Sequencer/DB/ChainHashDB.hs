
module Blockchain.Sequencer.DB.ChainHashDB where

import           Blockchain.ExtWord           (Word256)
import           Blockchain.Data.Transaction
import           Blockchain.SHA
import           Control.Monad.Catch
import           Control.Monad.Trans.Resource

import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import           Data.Maybe                   (fromMaybe)
import qualified Data.Sequence                as Q
import qualified Data.Set                     as S

getChainHashMap :: m (Map SHA (Bool, Word256))
getChainHashMap = chainHashMap <$> getPrivateHashDB

putChainHashMap :: Map SHA (Bool, Word256) -> m ()
putChainHashMap m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ chainHashMap = m }

lookupChainHash :: SHA -> m (Maybe (Bool, Word256))
lookupChainHash h = M.lookup h <$> getChainHashMap

insertChainHash :: SHA -> Word256 -> m ()
insertChainHash h cid = getChainHashMap >>= putChainHashMap . M.insert h (False, cid)

useChainHash :: SHA -> Word256 -> m ()
useChainHash h cid = getChainHashMap >>= putChainHashMap . M.alter (\_ -> Just (True, cid)) h

getChainBuffers :: m (Map Word256 (CircularBuffer SHA))
getChainBuffers = chainBuffers <$> getPrivateHashDB

putChainBuffers :: Map Word256 (CircularBuffer SHA) -> m ()
putChainBuffers m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ chainBuffers = m }

lookupChainBuffer :: Word256 -> m (CircularBuffer SHA)
lookupChainBuffer cid = maybe emptyCircularBuffer id . M.lookup cid <$> getChainBuffers

insertChainBuffer :: Word256 -> CircularBuffer SHA -> m ()
insertChainBuffer cid buf = getChainBuffers >>= putChainBuffers . M.insert cid buf

createChainBuffer :: Word256 -> m ()
createChainBuffer = flip insertChainBuffer emptyCircularBuffer

insertChainBufferEntry :: Word256 -> SHA -> m ()
insertChainBufferEntry cid h = do
  CircularBuffer cap sz q <- lookupChainBuffer cid
  let cb = if sz < cap
             then CircularBuffer cap (sz + 1) (q Q.|> h)
             else case Q.viewl q of
                    Q.EmptyL -> CircularBuffer cap 1 (q Q.|> h)
                    (_ Q.:< q') -> CircularBuffer cap sz (q' Q.|> h)
  insertChainBuffer cid cb

getChainHash :: Word256 -> m SHA
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
