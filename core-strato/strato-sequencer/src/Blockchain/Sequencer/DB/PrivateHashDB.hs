{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
module Blockchain.Sequencer.DB.PrivateHashDB where

import           Blockchain.Data.ExtendedWord  (Word256)
import           Blockchain.SHA
import           Control.Monad.Trans.Resource

import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as Map
import qualified Data.Sequence                as Q
import qualified Data.Set                     as S

import           Blockchain.Strato.Model.Class

data (TransactionLike t) => PrivateHashDB t =
                            PrivateHashDB { txHashMap    :: Map SHA t
                                          , chainHashMap :: Map SHA Word256
                                          , chainBuffers :: Map Word256 (CircularBuffer SHA)
                                          }

data CircularBuffer a =
     CircularBuffer { capacity :: Int
                    , size     :: Int
                    , queue    :: Q.Seq a
                    }

maxBufferCapacity :: Int
maxBufferCapacity = 4096

emptyCircularBuffer :: CircularBuffer a
emptyCircularBuffer = CircularBuffer maxBufferCapacity 0 Q.empty

emptyPrivateHashDB :: PrivateHashDB
emptyPrivateHashDB  = PrivateHashDB Map.empty Map.empty Map.empty

class (MonadResource m) => HasPrivateHashDB m where
    getPrivateHashDB :: m PrivateHashDB
    putPrivateHashDB :: PrivateHashDB -> m ()
    {-# MINIMAL getPrivateHashDB, putPrivateHashDB #-}

    getTxHashMap :: TransactionLike t => m (Map SHA t)
    getTxHashMap = txHashMap <$> getPrivateHashDB

    putTxHashMap :: TransactionLike t => Map SHA t -> m ()
    putTxHashMap m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ txHashMap = m }

    lookupTransaction :: TransactionLike t => SHA -> m (Maybe t)
    lookupTransaction h = Map.lookup h <$> getTxHashMap

    insertTransaction :: TransactionLike t => t -> m ()
    insertTransaction tx = getTxHashMap >>= putTxHashMap . Map.insert (txHash tx) tx

    getChainHashMap :: m (Map SHA Word256)
    getChainHashMap = chainHashMap <$> getPrivateHashDB

    putChainHashMap :: Map SHA Word256 -> m ()
    putChainHashMap m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ txHashMap = m }

    lookupChainHash :: SHA -> m (Maybe Word256)
    lookupChainHash h = Map.lookup h <$> getChainHashMap

    insertChainHash :: SHA -> Word256 -> m ()
    insertChainHash h cid = getChainHashMap >>= putChainHashMap . Map.insert h cid

    getChainBuffers :: m (Map Word256 (CircularBuffer SHA))
    getChainBuffers = chainBuffers <$> getPrivateHashDB

    putChainBuffers :: Map SHA Word256 -> m ()
    putChainBuffers m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ chainBuffers = m }

    lookupChainBuffer :: Word256 -> m (CircularBuffer SHA)
    lookupChainBuffer cid = maybe emptyCircularBuffer id . Map.lookup cid <$> getChainBuffers

    insertChainBuffer :: Word256 -> CircularBuffer SHA -> m ()
    insertChainBuffer cid buf = getChainBuffers >>= putChainBuffesr . Map.insert cid buf

    createChainBuffer :: Word256 -> m ()
    createChainBuffer = flip insertChainBuffer emptyCircularBuffer

    insertChainBufferEntry :: Word256 -> SHA -> m ()
    insertChainBufferEntry cid h = do
      CircularBuffer cap sz q <- lookupChainBuffer cid


    insertPrivateHash :: TransactionLike t => t -> m ()
    insertPrivateHash tx = do
      db <- getTxHashMap
      let r = txSigR tx
          s = txSigS tx
          h = txHash tx
          rs = hash (r,s)
          sr = hash (s,r)
      insertTransaction tx
      insertChainHash rs (txChainId tx)
      insertChainHash sr (txChainId tx)
      putTxHashMap Map.insert h tx db
