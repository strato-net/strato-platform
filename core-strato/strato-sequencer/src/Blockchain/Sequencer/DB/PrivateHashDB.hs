{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
module Blockchain.Sequencer.DB.PrivateHashDB where

import           Blockchain.ExtWord           (Word256)
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.RLP
import           Blockchain.Data.Transaction
import           Blockchain.SHA
import           Control.Monad.Catch
import           Control.Monad.Trans.Resource

import           Data.Bimap                   (Bimap)
import qualified Data.Bimap                   as B
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import           Data.Maybe                   (fromMaybe)
import qualified Data.Sequence                as Q
import qualified Data.Set                     as S

import           Blockchain.Strato.Model.Class

data PrivateHashDB =
     PrivateHashDB { txHashMap      :: Map SHA Transaction              -- TODO: Make these LDB entries
                   , chainHashMap   :: Map SHA (Bool, Word256)
                   , chainBuffers   :: Map Word256 (CircularBuffer SHA) -- TODO: Use buffers to remove old entries
                   , seenChains     :: S.Set Word256
                   , missingChainDB :: Map Word256 [SHA]
                   , seenHashes     :: Bimap SHA SHA                    -- transaction hashes and chain hashes
                   , missingTxs     :: S.Set SHA                        -- set of transaction hashes for chains we recognize but don't have data for
                   , dependentTxDB  :: Map SHA (S.Set SHA)              -- map from block hash to dependent transaction hashes
                   , txBlockDB      :: Map SHA SHA                      -- map from transaction hash to block hash
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
emptyPrivateHashDB  = PrivateHashDB M.empty M.empty M.empty S.empty M.empty
                                    B.empty S.empty M.empty M.empty

class (MonadResource m, MonadThrow m) => HasPrivateHashDB m where
    getPrivateHashDB :: m PrivateHashDB
    putPrivateHashDB :: PrivateHashDB -> m ()
    {-# MINIMAL getPrivateHashDB, putPrivateHashDB #-}

    getTxHashMap :: m (Map SHA Transaction)
    getTxHashMap = txHashMap <$> getPrivateHashDB

    putTxHashMap :: Map SHA Transaction -> m ()
    putTxHashMap m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ txHashMap = m }

    lookupTransaction :: SHA -> m (Maybe Transaction)
    lookupTransaction h = M.lookup h <$> getTxHashMap

    insertTransaction :: Transaction -> m ()
    insertTransaction tx = getTxHashMap >>= putTxHashMap . M.insert (txHash tx) tx

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
      insertSeenChain cId
      insertChainHash h cId
      insertChainBufferEntry cId h

    getSeenChainsDB :: m (S.Set Word256)
    getSeenChainsDB = seenChains <$> getPrivateHashDB

    putSeenChainsDB :: S.Set Word256 -> m ()
    putSeenChainsDB m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ seenChains = m }

    lookupSeenChain :: Word256 -> m Bool
    lookupSeenChain chainId = S.member chainId <$> getSeenChainsDB

    insertSeenChain :: Word256 -> m ()
    insertSeenChain chainId = getSeenChainsDB >>= putSeenChainsDB . S.insert chainId

    getMissingChainsDB :: m (Map Word256 [SHA])
    getMissingChainsDB = missingChainDB <$> getPrivateHashDB

    putMissingChainsDB :: Map Word256 [SHA] -> m ()
    putMissingChainsDB m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ missingChainDB = m }

    lookupMissingChainTxs :: Word256 -> m [SHA]
    lookupMissingChainTxs chainId = fromMaybe [] . M.lookup chainId <$> getMissingChainsDB

    insertMissingChainTx :: Word256 -> SHA -> m ()
    insertMissingChainTx chainId th = do
      m <- getMissingChainsDB
      case M.lookup chainId m of
        Nothing -> putMissingChainsDB (M.insert chainId [th] m)
        Just ths -> putMissingChainsDB (M.insert chainId (th:ths) m)

    insertMissingChainTxs :: Word256 -> [SHA] -> m ()
    insertMissingChainTxs chainId ths = getMissingChainsDB >>= putMissingChainsDB . M.insert chainId ths

    clearMissingChainTxs :: Word256 -> m ()
    clearMissingChainTxs chainId = getMissingChainsDB >>= putMissingChainsDB . M.delete chainId

    getSeenHashDB :: m (Bimap SHA SHA)
    getSeenHashDB = seenHashes <$> getPrivateHashDB

    putSeenHashDB :: Bimap SHA SHA -> m ()
    putSeenHashDB bm = getPrivateHashDB >>= \db -> putPrivateHashDB db{ seenHashes = bm }

    lookupSeenTxHash :: SHA -> m (Maybe SHA)
    lookupSeenTxHash th = do
      db <- getSeenHashDB
      if B.member th db
        then Just <$> B.lookup th db -- Data.Bimap calls `fail` if element is not in map
        else return Nothing

    lookupSeenChainHash :: SHA -> m (Maybe SHA)
    lookupSeenChainHash ch = do
      db <- getSeenHashDB
      if B.memberR ch db
        then Just <$> B.lookupR ch db -- Data.Bimap calls `fail` if element is not in map
        else return Nothing

    insertSeenTxHash :: SHA -> SHA -> m ()
    insertSeenTxHash th ch = getSeenHashDB >>= putSeenHashDB . B.insert th ch

    getMissingTxsDB :: m (S.Set SHA)
    getMissingTxsDB = missingTxs <$> getPrivateHashDB

    putMissingTxsDB :: S.Set SHA -> m ()
    putMissingTxsDB txs = getPrivateHashDB >>= \db -> putPrivateHashDB db{ missingTxs = txs }

    lookupMissingTx :: SHA -> m Bool
    lookupMissingTx tx = S.member tx <$> getMissingTxsDB

    insertMissingTx :: SHA -> m ()
    insertMissingTx tx = getMissingTxsDB >>= putMissingTxsDB . S.insert tx

    removeMissingTx :: SHA -> m ()
    removeMissingTx tx = getMissingTxsDB >>= putMissingTxsDB . S.delete tx

    getDependentTxDB :: m (Map SHA (S.Set SHA))
    getDependentTxDB = dependentTxDB <$> getPrivateHashDB

    putDependentTxDB :: Map SHA (S.Set SHA) -> m ()
    putDependentTxDB m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ dependentTxDB = m }

    lookupDependentTxs :: SHA -> m (S.Set SHA)
    lookupDependentTxs bHash = fromMaybe S.empty . M.lookup bHash <$> getDependentTxDB

    insertDependentTx :: SHA -> SHA -> m ()
    insertDependentTx bHash tHash = do
      m <- getDependentTxDB
      case M.lookup bHash m of
        Nothing -> putDependentTxDB (M.insert bHash (S.singleton tHash) m)
        Just ths -> putDependentTxDB (M.insert bHash (S.insert tHash ths) m)

    insertDependentTxs :: SHA -> S.Set SHA -> m ()
    insertDependentTxs bHash ths = getDependentTxDB >>= putDependentTxDB . M.insert bHash ths

    clearDependentTxs :: SHA -> m ()
    clearDependentTxs bHash = getDependentTxDB >>= putDependentTxDB . M.delete bHash

    getTxBlockDB :: m (Map SHA SHA)
    getTxBlockDB = txBlockDB <$> getPrivateHashDB

    putTxBlockDB :: Map SHA SHA -> m ()
    putTxBlockDB m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ txBlockDB = m }

    lookupTxBlocks :: SHA -> m (Maybe SHA)
    lookupTxBlocks tHash = M.lookup tHash <$> getTxBlockDB

    insertTxBlock :: SHA -> SHA -> m ()
    insertTxBlock tHash bHash = getTxBlockDB >>= putTxBlockDB . M.insert tHash bHash

    removeTxBlock :: SHA -> m ()
    removeTxBlock tHash = getTxBlockDB >>= putTxBlockDB . M.delete tHash
