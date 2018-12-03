{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
module Blockchain.Sequencer.DB.PrivateHashDB where

import           Blockchain.ExtWord           (Word256)
import           Blockchain.Sequencer.Event
import           Blockchain.SHA
import           Control.Monad.Trans.Resource

import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import qualified Data.Sequence                as Q
import qualified Data.Set                     as S

data PrivateHashDB =
     PrivateHashDB { txHashMap      :: Map SHA OutputTx                 -- TODO: Make these LDB entries
                   , chainHashMap   :: Map SHA (Bool, Word256)
                   , chainBuffers   :: Map Word256 (CircularBuffer SHA) -- TODO: Use buffers to remove old entries
                   , seenChains     :: S.Set Word256
                   , missingChainDB :: Map Word256 [SHA]
                   , seenTXs        :: S.Set SHA                        -- set of seen transaction hashes
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
                                    S.empty S.empty M.empty M.empty

class MonadResource m => HasPrivateHashDB m where
    getPrivateHashDB :: m PrivateHashDB
    putPrivateHashDB :: PrivateHashDB -> m ()
