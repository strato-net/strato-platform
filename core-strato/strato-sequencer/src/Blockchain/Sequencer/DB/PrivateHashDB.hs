{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
module Blockchain.Sequencer.DB.PrivateHashDB where

import           Blockchain.ExtWord           (Word256)
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.RLP
import           Blockchain.Data.Transaction
import           Blockchain.SHA
import           Control.Monad.Trans.Resource

import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as Map
import qualified Data.Sequence                as Q
import qualified Data.Set                     as S

import           Blockchain.Strato.Model.Class

data PrivateHashDB =
     PrivateHashDB { txHashMap    :: Map SHA Transaction -- TODO: Make these LDB entries
                   , chainHashMap :: Map SHA (Bool, Word256)
                   , chainBuffers :: Map Word256 (CircularBuffer SHA) -- TODO: Use buffers to remove old entries
                   , seenChains   :: S.Set Word256
                   , missingChainDB :: Map Word256 [Transaction]
                   }

data CircularBuffer a =
     CircularBuffer { capacity :: Int
                    , size     :: Int
                    , queue    :: Q.Seq a
                    } deriving (Show)

maxBufferCapacity :: Int
maxBufferCapacity = 4096

emptyCircularBuffer :: CircularBuffer a
emptyCircularBuffer = CircularBuffer maxBufferCapacity 0 Q.empty

emptyPrivateHashDB :: PrivateHashDB
emptyPrivateHashDB  = PrivateHashDB Map.empty Map.empty Map.empty S.empty Map.empty

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

    getChainHashMap :: m (Map SHA (Bool, Word256))
    getChainHashMap = chainHashMap <$> getPrivateHashDB

    putChainHashMap :: Map SHA (Bool, Word256) -> m ()
    putChainHashMap m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ chainHashMap = m }

    lookupChainHash :: SHA -> m (Maybe (Bool, Word256))
    lookupChainHash h = Map.lookup h <$> getChainHashMap

    insertChainHash :: SHA -> Word256 -> m ()
    insertChainHash h cid = getChainHashMap >>= putChainHashMap . Map.insert h (False, cid)

    useChainHash :: SHA -> Word256 -> m ()
    useChainHash h cid = getChainHashMap >>= putChainHashMap . Map.alter (\_ -> Just (True, cid)) h

    getChainBuffers :: m (Map Word256 (CircularBuffer SHA))
    getChainBuffers = chainBuffers <$> getPrivateHashDB

    putChainBuffers :: Map Word256 (CircularBuffer SHA) -> m ()
    putChainBuffers m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ chainBuffers = m }

    lookupChainBuffer :: Word256 -> m (CircularBuffer SHA)
    lookupChainBuffer cid = maybe emptyCircularBuffer id . Map.lookup cid <$> getChainBuffers

    insertChainBuffer :: Word256 -> CircularBuffer SHA -> m ()
    insertChainBuffer cid buf = getChainBuffers >>= putChainBuffers . Map.insert cid buf

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

    insertPrivateHash :: Transaction -> m (SHA, SHA)
    insertPrivateHash tx = case txChainId tx of
      Nothing -> error "insertPrivateHash: Trying to insert a public transaction"
      Just chainId -> do
        let r = txSigR tx
            s = txSigS tx
            h = txHash tx
            rs = hash . rlpSerialize $ RLPArray [rlpEncode r, rlpEncode s]
            sr = hash . rlpSerialize $ RLPArray [rlpEncode s, rlpEncode r]
        insertTransaction tx
        insertChainHash rs chainId
        insertChainHash sr chainId
        chainHash <- getChainHash chainId
        insertChainBufferEntry chainId rs
        insertChainBufferEntry chainId sr
        return (h, chainHash)

    insertChainInfo :: Word256 -> ChainInfo -> m ()
    insertChainInfo cId cInfo = do
      let h = hash . rlpSerialize $ rlpEncode cInfo
      insertChainHash h cId
      insertChainBufferEntry cId h

    lookupChainId :: Word256 -> m Bool
    lookupChainId chainId = do
      db <- getPrivateHashDB
      return $ S.member chainId (seenChains db)

    insertChainId :: Word256 -> m ()
    insertChainId chainId = do
      db <- getPrivateHashDB
      putPrivateHashDB db{seenChains = S.insert chainId (seenChains db)}

    lookupMissingTxs :: Word256 -> m [Transaction]
    lookupMissingTxs chainId = do
      db <- missingChainDB <$> getPrivateHashDB
      case Map.lookup chainId db of
        Nothing -> return []
        Just txs -> return txs

    insertMissingTx :: Word256 -> Transaction -> m ()
    insertMissingTx chainId tx = do
      db <- getPrivateHashDB
      let m = missingChainDB db
      case Map.lookup chainId m of
        Nothing -> putPrivateHashDB db{missingChainDB = Map.insert chainId [tx] m}
        Just stuff -> putPrivateHashDB db{missingChainDB = Map.insert chainId (tx:stuff) m}

    clearMissingTxs :: Word256 -> m ()
    clearMissingTxs chainId = do
      db <- getPrivateHashDB
      putPrivateHashDB db{missingChainDB = Map.delete chainId (missingChainDB db)}
