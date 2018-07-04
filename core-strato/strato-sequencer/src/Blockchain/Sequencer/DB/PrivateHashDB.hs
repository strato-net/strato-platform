{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
module Blockchain.Sequencer.DB.PrivateHashDB where

import           Blockchain.ExtWord           (Word256)
import           Blockchain.Data.Transaction
import           Blockchain.SHA
import           Control.Monad.Trans.Resource

import           Data.Bimap                   (Bimap)
import qualified Data.Bimap                   as B
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import           Data.Maybe                   (fromMaybe)
import qualified Data.Sequence                as Q
import qualified Data.Set                     as S

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

class MonadResource m => HasPrivateHashDB m where
    getPrivateHashDB :: m PrivateHashDB
    putPrivateHashDB :: PrivateHashDB -> m ()
    {-# MINIMAL getPrivateHashDB, putPrivateHashDB #-}

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
