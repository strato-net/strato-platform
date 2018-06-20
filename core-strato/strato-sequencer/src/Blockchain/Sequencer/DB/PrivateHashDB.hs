{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
module Blockchain.Sequencer.DB.PrivateHashDB where

import           Blockchain.ExtWord           (Word256)
import           Blockchain.Data.RLP
import           Blockchain.Data.Transaction
import           Blockchain.Data.TransactionDef
import           Blockchain.SHA
import           Control.Monad.Trans.Resource

import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as Map
import qualified Data.Sequence                as Q
import qualified Data.Set                     as S

import           Blockchain.Strato.Model.Class

data PrivateHashDB =
     PrivateHashDB { txHashMap    :: Map SHA Transaction -- TODO: Make these LDB entries
                   , chainHashMap :: Map SHA Word256
                   -- , chainBuffers :: Map Word256 (CircularBuffer SHA) -- TODO: Use buffers to remove old entries
                   }

-- data CircularBuffer a =
--      CircularBuffer { capacity :: Int
--                     , size     :: Int
--                     , queue    :: Q.Seq a
--                     }
--
-- maxBufferCapacity :: Int
-- maxBufferCapacity = 4096
--
-- emptyCircularBuffer :: CircularBuffer a
-- emptyCircularBuffer = CircularBuffer maxBufferCapacity 0 Q.empty

emptyPrivateHashDB :: PrivateHashDB
emptyPrivateHashDB  = PrivateHashDB Map.empty Map.empty -- Map.empty

class (MonadResource m) => HasPrivateHashDB m where
    getPrivateHashDB :: m PrivateHashDB
    putPrivateHashDB :: PrivateHashDB -> m ()
    {-# MINIMAL getPrivateHashDB, putPrivateHashDB #-}

    getTxHashMap :: m (Map SHA Transaction)
    getTxHashMap = txHashMap <$> getPrivateHashDB

    putTxHashMap :: Map SHA Transaction -> m ()
    putTxHashMap m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ txHashMap = m }

    lookupTransaction :: SHA -> m (Maybe Transaction)
    lookupTransaction h = Map.lookup h <$> getTxHashMap

    insertTransaction :: Transaction -> m ()
    insertTransaction tx = getTxHashMap >>= putTxHashMap . Map.insert (txHash tx) tx

    getChainHashMap :: m (Map SHA Word256)
    getChainHashMap = chainHashMap <$> getPrivateHashDB

    putChainHashMap :: Map SHA Word256 -> m ()
    putChainHashMap m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ chainHashMap = m }

    lookupChainHash :: SHA -> m (Maybe Word256)
    lookupChainHash h = Map.lookup h <$> getChainHashMap

    insertChainHash :: SHA -> Word256 -> m ()
    insertChainHash h cid = getChainHashMap >>= putChainHashMap . Map.insert h cid

--    getChainBuffers :: m (Map Word256 (CircularBuffer SHA))
--    getChainBuffers = chainBuffers <$> getPrivateHashDB
--
--    putChainBuffers :: Map SHA Word256 -> m ()
--    putChainBuffers m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ chainBuffers = m }
--
--    lookupChainBuffer :: Word256 -> m (CircularBuffer SHA)
--    lookupChainBuffer cid = maybe emptyCircularBuffer id . Map.lookup cid <$> getChainBuffers
--
--    insertChainBuffer :: Word256 -> CircularBuffer SHA -> m ()
--    insertChainBuffer cid buf = getChainBuffers >>= putChainBuffesr . Map.insert cid buf
--
--    createChainBuffer :: Word256 -> m ()
--    createChainBuffer = flip insertChainBuffer emptyCircularBuffer
--
--    insertChainBufferEntry :: Word256 -> SHA -> m ()
--    insertChainBufferEntry cid h = do
--      CircularBuffer cap sz q <- lookupChainBuffer cid


    insertPrivateHash :: Transaction -> m ()
    insertPrivateHash tx = case txChainId tx of
      Nothing -> return ()
      Just chainId -> do
        let r = txSigR tx
            s = txSigS tx
            rs = hash . rlpSerialize $ RLPArray [rlpEncode r, rlpEncode s]
            sr = hash . rlpSerialize $ RLPArray [rlpEncode s, rlpEncode r]
        insertTransaction tx
        insertChainHash rs chainId
        insertChainHash sr chainId
