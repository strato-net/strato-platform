{-# LANGUAGE RecordWildCards        #-}
{-# LANGUAGE StrictData             #-}
{-# LANGUAGE TemplateHaskell        #-}

module Blockchain.Privacy.Monad where

import           Blockchain.Data.ChainInfo
import           Blockchain.Data.RLP
import           Blockchain.ExtWord            (Word256)
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import           Blockchain.Util
import           Control.Lens
import           Data.Aeson
import           Data.Binary
import           Data.Default
import           Data.Foldable                 (toList)
import           Data.Function                 (on)
import qualified Data.Sequence                 as Q
import           Data.Set                      (Set)
import qualified Data.Set                      as S
import           GHC.Generics
import           Text.Format

data CircularBuffer a = CircularBuffer
  { _capacity :: Int
  , _size     :: Int
  , _queue    :: Q.Seq a
  } deriving (Show, Generic, Binary)
makeLenses ''CircularBuffer

instance ToJSON a => ToJSON (CircularBuffer a) where
instance FromJSON a => FromJSON (CircularBuffer a) where

maxBufferCapacity :: Int
maxBufferCapacity = 4096

emptyCircularBuffer :: CircularBuffer a
emptyCircularBuffer = CircularBuffer maxBufferCapacity 0 Q.empty

instance Default (CircularBuffer a) where
  def = emptyCircularBuffer

instance Format a => Format (CircularBuffer a) where
  format CircularBuffer{..} = unlines
    [ "CircularBuffer"
    , "--------------"
    , tab $ "Capacity: " ++ show _capacity
    , tab $ "Size:     " ++ show _size
    , tab $ "Queue:    " ++ format (toList _queue)
    ]

data BlockInfo = BlockInfo
  { _bhash     :: SHA
  , _bordering :: Integer
  } deriving (Eq, Show, Generic, Binary)
makeLenses ''BlockInfo

instance ToJSON BlockInfo where
instance FromJSON BlockInfo where

instance Format BlockInfo where
  format BlockInfo{..} = unlines
    [ "BlockInfo"
    , "---------"
    , tab $ "Block hash:     " ++ format _bhash
    , tab $ "Block ordering: " ++ show _bordering
    ]

instance Ord BlockInfo where
  compare = compare `on` _bordering

data ChainHashEntry = ChainHashEntry
  { _used         :: Bool
  , _onChainId    :: Maybe Word256
  , _inBlocks     :: Set BlockInfo
  } deriving (Show, Generic, Binary)
makeLenses ''ChainHashEntry

instance ToJSON ChainHashEntry where
instance FromJSON ChainHashEntry where

blankChainHashEntry :: ChainHashEntry
blankChainHashEntry = ChainHashEntry False Nothing S.empty

instance Default ChainHashEntry where
  def = blankChainHashEntry

instance Format ChainHashEntry where
  format ChainHashEntry{..} = unlines
    [ "ChainHashEntry"
    , "--------------"
    , tab $ "Used:      " ++ show _used
    , tab $ "On chain:  " ++ format (SHA <$> _onChainId)
    , tab $ "In blocks: " ++ format (toList _inBlocks)
    ]

chainHashEntryUsed :: ChainHashEntry
chainHashEntryUsed = ChainHashEntry True Nothing S.empty

chainHashEntryWithChainId :: Word256 -> ChainHashEntry
chainHashEntryWithChainId chainId = ChainHashEntry False (Just chainId) S.empty

chainHashEntryInBlock :: BlockInfo -> ChainHashEntry
chainHashEntryInBlock bInfo = ChainHashEntry True Nothing (S.singleton bInfo)

data ChainIdEntry = ChainIdEntry
  { _chainIdInfo :: ChainInfo
  , _chainHashes :: CircularBuffer SHA
  , _blocksToRun :: Set BlockInfo
  } deriving (Show, Generic, Binary)
makeLenses ''ChainIdEntry

instance ToJSON ChainIdEntry where
instance FromJSON ChainIdEntry where

chainIdEntry :: ChainInfo -> ChainIdEntry
chainIdEntry cInfo = ChainIdEntry cInfo emptyCircularBuffer S.empty

instance Format ChainIdEntry where
  format ChainIdEntry{..} = unlines
    [ "ChainIdEntry"
    , "------------"
    , tab $ "Chain info:"
    , tab $ format _chainIdInfo
    , tab $ "Chain hashes:  " ++ format _chainHashes
    , tab $ "Blocks to run: " ++ format (toList _blocksToRun)
    ]

class HasPrivateHashDB m where
  requestChain             :: Word256 -> m ()
  requestTransaction       :: SHA -> m ()

getChainId :: ChainInfo -> SHA
getChainId = hash . rlpSerialize . rlpEncode

generateInitialChainHash :: ChainInfo -> SHA
generateInitialChainHash = hash . rlpSerialize . rlpEncode

-- Point-free with permutations is less readable, but more fun
generateChainHashes :: OutputTx -> [SHA]
generateChainHashes tx =
  let r = txSigR tx
      s = txSigS tx
      rs = hash . rlpSerialize $ RLPArray [rlpEncode r, rlpEncode s]
      sr = hash . rlpSerialize $ RLPArray [rlpEncode s, rlpEncode r]
   in [rs,sr]
