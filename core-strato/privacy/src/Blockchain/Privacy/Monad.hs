{-# LANGUAGE ConstraintKinds        #-}
{-# LANGUAGE FlexibleContexts       #-}
{-# LANGUAGE FlexibleInstances      #-}
{-# LANGUAGE LambdaCase             #-}
{-# LANGUAGE RecordWildCards        #-}
{-# LANGUAGE StrictData             #-}
{-# LANGUAGE TemplateHaskell        #-}
{-# LANGUAGE TypeOperators          #-}

module Blockchain.Privacy.Monad where

import           Blockchain.Data.ChainInfo
import           Blockchain.ExtWord            (Word256)
import           Blockchain.Sequencer.Event
import           Blockchain.SHA
import           Control.Lens
import           Control.Monad.Change
import           Control.Monad.Logger
import           Control.Monad.Trans.Resource
import           Data.Function                 (on)
import qualified Data.Sequence                 as Q
import           Data.Set                      (Set)
import qualified Data.Set                      as S

data CircularBuffer a = CircularBuffer
  { _capacity :: Int
  , _size     :: Int
  , _queue    :: Q.Seq a
  } deriving (Show)
makeLenses ''CircularBuffer

maxBufferCapacity :: Int
maxBufferCapacity = 4096

emptyCircularBuffer :: CircularBuffer a
emptyCircularBuffer = CircularBuffer maxBufferCapacity 0 Q.empty

data ChainHashEntry = ChainHashEntry
  { _used         :: Bool
  , _onChainId    :: Maybe Word256
  , _inBlocks     :: Q.Seq SHA
  } deriving (Show)
makeLenses ''ChainHashEntry

chainHashEntryUsed :: ChainHashEntry
chainHashEntryUsed = ChainHashEntry True Nothing Q.empty

chainHashEntryWithChainId :: Word256 -> ChainHashEntry
chainHashEntryWithChainId chainId = ChainHashEntry False (Just chainId) Q.empty

chainHashEntryInBlock :: SHA -> ChainHashEntry
chainHashEntryInBlock bHash = ChainHashEntry True Nothing (Q.singleton bHash)

data BlockInfo = BlockInfo
  { _bhash     :: SHA
  , _bordering :: Integer
  } deriving (Eq, Show)
makeLenses ''BlockInfo

instance Ord BlockInfo where
  compare = compare `on` _bordering

data ChainIdEntry = ChainIdEntry
  { _chainIdInfo :: ChainInfo
  , _chainHashes :: CircularBuffer SHA
  , _blocksToRun :: Set BlockInfo
  } deriving (Show)
makeLenses ''ChainIdEntry

chainIdEntry :: ChainInfo -> ChainIdEntry
chainIdEntry cInfo = ChainIdEntry cInfo emptyCircularBuffer S.empty

type HasBlockHashDB = SHA     `Alters` OutputBlock
type HasTxHashDB    = SHA     `Alters` OutputTx
type HasChainHashDB = SHA     `Alters` ChainHashEntry
type HasChainIdDB   = Word256 `Alters` ChainIdEntry

class ( MonadResource m
      , MonadLogger m
      , HasBlockHashDB m
      , HasTxHashDB m
      , HasChainHashDB m
      , HasChainIdDB m
      ) => HasPrivateHashDB m where
  getChainId               :: ChainInfo -> m SHA
  generateInitialChainHash :: ChainInfo -> m SHA
  generateChainHashes      :: OutputTx -> m [SHA]
  requestChain             :: Word256 -> m ()
  requestTransaction       :: SHA -> m ()
