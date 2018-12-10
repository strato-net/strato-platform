{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE TemplateHaskell       #-}

module Blockchain.Sequencer.DB.PrivateHashDB where

import           Blockchain.Data.ChainInfo
import           Blockchain.ExtWord           (Word256)
import           Blockchain.Format
import           Blockchain.Strato.Model.Class
import           Blockchain.Sequencer.Event
import           Blockchain.SHA
import           Control.Lens
import           Control.Monad                (join, void, when)
import           Control.Monad.Trans.Class    (lift)
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.State

import           Data.Foldable                (for_)
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import           Data.Maybe                   (fromJust)
import qualified Data.Sequence                as Q
import           Data.Set                     (Set)
import qualified Data.Set                     as S
import           Data.Traversable             (for)

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

data BlockHashEntry = BlockHashEntry
  { _outputBlock  :: OutputBlock
  , _dependentTXs :: Set SHA
  , _txHashMap    :: Map SHA SHA
  , _chainHashMap :: Map SHA (Set SHA)
  }
makeLenses ''BlockHashEntry

blockHashEntry :: OutputBlock -> BlockHashEntry
blockHashEntry ob = BlockHashEntry ob S.empty M.empty M.empty

data TxHashEntry = TxHashEntry
  { _outputTx  :: Maybe OutputTx
  , _chainHash :: Maybe SHA
  , _inBlock   :: Maybe SHA
  } deriving (Show)
makeLenses ''TxHashEntry

emptyTxHashEntry :: TxHashEntry
emptyTxHashEntry = TxHashEntry Nothing Nothing Nothing

txHashEntryWithOutputTx :: OutputTx -> TxHashEntry
txHashEntryWithOutputTx otx = TxHashEntry (Just otx) Nothing Nothing

txHashEntryWithChainHash :: SHA -> TxHashEntry
txHashEntryWithChainHash cHash = TxHashEntry Nothing (Just cHash) Nothing

txHashEntryWithBlockHash :: SHA -> TxHashEntry
txHashEntryWithBlockHash bHash = TxHashEntry Nothing Nothing (Just bHash)

data ChainHashEntry = ChainHashEntry
  { _used         :: Bool
  , _onChainId    :: Word256
  , _transactions :: Set SHA
  , _inBlocks     :: Set SHA
  }
makeLenses ''ChainHashEntry

chainHashEntry :: Word256 -> ChainHashEntry
chainHashEntry chainId = ChainHashEntry False chainId S.empty S.empty

data ChainIdEntry = ChainIdEntry
  { _chainInfo   :: ChainInfo
  , _chainHashes :: CircularBuffer SHA
  , _missingTXs  :: Set SHA
  }
makeLenses ''ChainIdEntry

chainIdEntry :: ChainInfo -> ChainIdEntry
chainIdEntry cInfo = ChainIdEntry cInfo emptyCircularBuffer S.empty

class MonadResource m => HasRegistry m where
  generateChainHashes :: OutputTx -> m [SHA]
  alterBlockHashEntry :: SHA     -> (Maybe BlockHashEntry -> m (Maybe BlockHashEntry)) -> m (Maybe BlockHashEntry)
  alterTxHashEntry    :: SHA     -> (Maybe TxHashEntry    -> m (Maybe TxHashEntry)   ) -> m (Maybe TxHashEntry)
  alterChainHashEntry :: SHA     -> (Maybe ChainHashEntry -> m (Maybe ChainHashEntry)) -> m (Maybe ChainHashEntry)
  alterChainIdEntry   :: Word256 -> (Maybe ChainIdEntry   -> m (Maybe ChainIdEntry)  ) -> m (Maybe ChainIdEntry)

ffor :: (Applicative f, Monad t, Traversable t) => t a -> (a -> f (t b)) -> f (t b)
ffor t = fmap join . for t

updateBlockHashEntry :: HasRegistry m => SHA -> (BlockHashEntry -> m (Maybe BlockHashEntry)) -> m (Maybe BlockHashEntry)
updateBlockHashEntry bHash = alterBlockHashEntry bHash . flip ffor

updateBlockHashEntryState :: HasRegistry m => SHA -> StateT BlockHashEntry m (Maybe BlockHashEntry) -> m (Maybe BlockHashEntry)
updateBlockHashEntryState bHash = updateBlockHashEntry bHash . evalStateT

modifyBlockHashEntry :: HasRegistry m => SHA -> (BlockHashEntry -> m BlockHashEntry) -> m BlockHashEntry
modifyBlockHashEntry bHash f = fmap fromJust $ updateBlockHashEntry bHash (fmap Just . f)

modifyBlockHashEntryState :: HasRegistry m => SHA -> StateT BlockHashEntry m () -> m BlockHashEntry
modifyBlockHashEntryState bHash = modifyBlockHashEntry bHash . execStateT

repsertBlockHashEntry :: HasRegistry m => SHA -> (Maybe BlockHashEntry -> m BlockHashEntry) -> m BlockHashEntry
repsertBlockHashEntry bHash f = fmap fromJust $ alterBlockHashEntry bHash (fmap Just . f)

insertBlockHashEntry :: HasRegistry m => SHA -> BlockHashEntry -> m ()
insertBlockHashEntry bHash bhe = alterBlockHashEntry_ bHash (return . const (Just bhe))

getBlockHashEntry :: HasRegistry m => SHA -> m (Maybe BlockHashEntry)
getBlockHashEntry bHash = alterBlockHashEntry bHash return

alterBlockHashEntry_ :: HasRegistry m => SHA -> (Maybe BlockHashEntry -> m (Maybe BlockHashEntry)) -> m ()
alterBlockHashEntry_ bHash = void . alterBlockHashEntry bHash

updateBlockHashEntry_ :: HasRegistry m => SHA -> (BlockHashEntry -> m (Maybe BlockHashEntry)) -> m ()
updateBlockHashEntry_ bHash = void . updateBlockHashEntry bHash

updateBlockHashEntryState_ :: HasRegistry m => SHA -> StateT BlockHashEntry m (Maybe BlockHashEntry) -> m ()
updateBlockHashEntryState_ bHash = void . updateBlockHashEntryState bHash

modifyBlockHashEntry_ :: HasRegistry m => SHA -> (BlockHashEntry -> m BlockHashEntry) -> m ()
modifyBlockHashEntry_ bHash = void . modifyBlockHashEntry bHash

modifyBlockHashEntryState_ :: HasRegistry m => SHA -> StateT BlockHashEntry m () -> m ()
modifyBlockHashEntryState_ bHash = void . modifyBlockHashEntryState bHash

repsertBlockHashEntry_ :: HasRegistry m => SHA -> (Maybe BlockHashEntry -> m BlockHashEntry) -> m ()
repsertBlockHashEntry_ bHash = void . repsertBlockHashEntry bHash

updateTxHashEntry :: HasRegistry m => SHA -> (TxHashEntry -> m (Maybe TxHashEntry)) -> m (Maybe TxHashEntry)
updateTxHashEntry tHash = alterTxHashEntry tHash . flip ffor

updateTxHashEntryState :: HasRegistry m => SHA -> StateT TxHashEntry m (Maybe TxHashEntry) -> m (Maybe TxHashEntry)
updateTxHashEntryState tHash = updateTxHashEntry tHash . evalStateT

modifyTxHashEntry :: HasRegistry m => SHA -> (TxHashEntry -> m TxHashEntry) -> m TxHashEntry
modifyTxHashEntry tHash f = fmap fromJust $ updateTxHashEntry tHash (fmap Just . f)

modifyTxHashEntryState :: HasRegistry m => SHA -> StateT TxHashEntry m () -> m TxHashEntry
modifyTxHashEntryState tHash = modifyTxHashEntry tHash . execStateT

repsertTxHashEntry :: HasRegistry m => SHA -> (Maybe TxHashEntry -> m TxHashEntry) -> m TxHashEntry
repsertTxHashEntry tHash f = fmap fromJust $ alterTxHashEntry tHash (fmap Just . f)

insertTxHashEntry :: HasRegistry m => SHA -> TxHashEntry -> m ()
insertTxHashEntry tHash the = alterTxHashEntry_ tHash (return . const (Just the))

getTxHashEntry :: HasRegistry m => SHA -> m (Maybe TxHashEntry)
getTxHashEntry tHash = alterTxHashEntry tHash return

alterTxHashEntry_ :: HasRegistry m => SHA -> (Maybe TxHashEntry -> m (Maybe TxHashEntry)) -> m ()
alterTxHashEntry_ tHash = void . alterTxHashEntry tHash

updateTxHashEntry_ :: HasRegistry m => SHA -> (TxHashEntry -> m (Maybe TxHashEntry)) -> m ()
updateTxHashEntry_ tHash = void . updateTxHashEntry tHash

updateTxHashEntryState_ :: HasRegistry m => SHA -> StateT TxHashEntry m (Maybe TxHashEntry) -> m ()
updateTxHashEntryState_ tHash = void . updateTxHashEntryState tHash

modifyTxHashEntry_ :: HasRegistry m => SHA -> (TxHashEntry -> m TxHashEntry) -> m ()
modifyTxHashEntry_ tHash = void . modifyTxHashEntry tHash

modifyTxHashEntryState_ :: HasRegistry m => SHA -> StateT TxHashEntry m () -> m ()
modifyTxHashEntryState_ tHash = void . modifyTxHashEntryState tHash

repsertTxHashEntry_ :: HasRegistry m => SHA -> (Maybe TxHashEntry -> m TxHashEntry) -> m ()
repsertTxHashEntry_ tHash = void . repsertTxHashEntry tHash

updateChainHashEntry :: HasRegistry m => SHA -> (ChainHashEntry -> m (Maybe ChainHashEntry)) -> m (Maybe ChainHashEntry)
updateChainHashEntry cHash = alterChainHashEntry cHash . flip ffor

updateChainHashEntryState :: HasRegistry m => SHA -> StateT ChainHashEntry m (Maybe ChainHashEntry) -> m (Maybe ChainHashEntry)
updateChainHashEntryState cHash = updateChainHashEntry cHash . evalStateT

modifyChainHashEntry :: HasRegistry m => SHA -> (ChainHashEntry -> m ChainHashEntry) -> m ChainHashEntry
modifyChainHashEntry cHash f = fmap fromJust $ updateChainHashEntry cHash (fmap Just . f)

modifyChainHashEntryState :: HasRegistry m => SHA -> StateT ChainHashEntry m () -> m ChainHashEntry
modifyChainHashEntryState cHash = modifyChainHashEntry cHash . execStateT

repsertChainHashEntry :: HasRegistry m => SHA -> (Maybe ChainHashEntry -> m ChainHashEntry) -> m ChainHashEntry
repsertChainHashEntry cHash f = fmap fromJust $ alterChainHashEntry cHash (fmap Just . f)

insertChainHashEntry :: HasRegistry m => SHA -> ChainHashEntry -> m ()
insertChainHashEntry cHash che = alterChainHashEntry_ cHash (return . const (Just che))

getChainHashEntry :: HasRegistry m => SHA -> m (Maybe ChainHashEntry)
getChainHashEntry cHash = alterChainHashEntry cHash return

alterChainHashEntry_ :: HasRegistry m => SHA -> (Maybe ChainHashEntry -> m (Maybe ChainHashEntry)) -> m ()
alterChainHashEntry_ cHash = void . alterChainHashEntry cHash

updateChainHashEntry_ :: HasRegistry m => SHA -> (ChainHashEntry -> m (Maybe ChainHashEntry)) -> m ()
updateChainHashEntry_ cHash = void . updateChainHashEntry cHash

updateChainHashEntryState_ :: HasRegistry m => SHA -> StateT ChainHashEntry m (Maybe ChainHashEntry) -> m ()
updateChainHashEntryState_ cHash = void . updateChainHashEntryState cHash

modifyChainHashEntry_ :: HasRegistry m => SHA -> (ChainHashEntry -> m ChainHashEntry) -> m ()
modifyChainHashEntry_ cHash = void . modifyChainHashEntry cHash

modifyChainHashEntryState_ :: HasRegistry m => SHA -> StateT ChainHashEntry m () -> m ()
modifyChainHashEntryState_ cHash = void . modifyChainHashEntryState cHash

repsertChainHashEntry_ :: HasRegistry m => SHA -> (Maybe ChainHashEntry -> m ChainHashEntry) -> m ()
repsertChainHashEntry_ cHash = void . repsertChainHashEntry cHash

updateChainIdEntry :: HasRegistry m => Word256 -> (ChainIdEntry -> m (Maybe ChainIdEntry)) -> m (Maybe ChainIdEntry)
updateChainIdEntry cId = alterChainIdEntry cId . flip ffor

updateChainIdEntryState :: HasRegistry m => Word256 -> StateT ChainIdEntry m (Maybe ChainIdEntry) -> m (Maybe ChainIdEntry)
updateChainIdEntryState cId = updateChainIdEntry cId . evalStateT

modifyChainIdEntry :: HasRegistry m => Word256 -> (ChainIdEntry -> m ChainIdEntry) -> m ChainIdEntry
modifyChainIdEntry cId f = fmap fromJust $ updateChainIdEntry cId (fmap Just . f)

modifyChainIdEntryState :: HasRegistry m => Word256 -> StateT ChainIdEntry m () -> m ChainIdEntry
modifyChainIdEntryState cId = modifyChainIdEntry cId . execStateT

repsertChainIdEntry :: HasRegistry m => Word256 -> (Maybe ChainIdEntry -> m ChainIdEntry) -> m ChainIdEntry
repsertChainIdEntry cId f = fmap fromJust $ alterChainIdEntry cId (fmap Just . f)

insertChainIdEntry :: HasRegistry m => Word256 -> ChainIdEntry -> m ()
insertChainIdEntry cId cie = alterChainIdEntry_ cId (return . const (Just cie))

getChainIdEntry :: HasRegistry m => Word256 -> m (Maybe ChainIdEntry)
getChainIdEntry cId = alterChainIdEntry cId return

alterChainIdEntry_ :: HasRegistry m => Word256 -> (Maybe ChainIdEntry -> m (Maybe ChainIdEntry)) -> m ()
alterChainIdEntry_ cId = void . alterChainIdEntry cId

updateChainIdEntry_ :: HasRegistry m => Word256 -> (ChainIdEntry -> m (Maybe ChainIdEntry)) -> m ()
updateChainIdEntry_ cId = void . updateChainIdEntry cId

updateChainIdEntryState_ :: HasRegistry m => Word256 -> StateT ChainIdEntry m (Maybe ChainIdEntry) -> m ()
updateChainIdEntryState_ cId = void . updateChainIdEntryState cId

modifyChainIdEntry_ :: HasRegistry m => Word256 -> (ChainIdEntry -> m ChainIdEntry) -> m ()
modifyChainIdEntry_ cId = void . modifyChainIdEntry cId

modifyChainIdEntryState_ :: HasRegistry m => Word256 -> StateT ChainIdEntry m () -> m ()
modifyChainIdEntryState_ cId = void . modifyChainIdEntryState cId

repsertChainIdEntry_ :: HasRegistry m => Word256 -> (Maybe ChainIdEntry -> m ChainIdEntry) -> m ()
repsertChainIdEntry_ cId = void . repsertChainIdEntry cId

insertHashPairs :: HasRegistry m => SHA -> Map SHA SHA -> m ()
insertHashPairs bHash thchs = repsertBlockHashEntry_ bHash $ \case
  Nothing -> error $ "insertThChPairs: Block hash " ++ format bHash ++ " not found"
  Just bhe -> return . flip execState bhe $ do
    txHashMap %= M.union thchs
    chainHashMap %= build (M.toList thchs)
  where build :: [(SHA,SHA)] -> Map SHA (Set SHA) -> Map SHA (Set SHA)
        build [] m = m
        build ((th,ch):xs) m = build xs $ M.alter (Just . maybe (S.singleton th) (S.insert th)) ch m

removeMissingTxEntry :: HasRegistry m => SHA -> m ()
removeMissingTxEntry tHash = do
  mthe <- getTxHashEntry tHash
  for_ mthe $ \TxHashEntry{_outputTx = otx} ->
    for_ otx $ \tx ->
      modifyChainIdEntryState_ (fromJust $ txChainId tx) $
        missingTXs %= S.delete tHash

removeTransaction :: HasRegistry m => SHA -> m ()
removeTransaction tHash = updateTxHashEntryState_ tHash $ do
  body <- use outputTx
  for_ body $ \tx ->
    lift . modifyChainIdEntryState_ (fromJust $ txChainId tx) $
      missingTXs %= S.delete tHash
  bh <- use inBlock
  for_ bh $ \bHash ->
    lift . updateBlockHashEntryState_ bHash $ do
      depTXs <- dependentTXs <%= S.delete tHash
      mChash <- use (txHashMap . at tHash)
      mPairs <- for mChash $ \cHash -> do
        txHashMap %= M.delete tHash
        ths <- chainHashMap . at cHash . _Just <%= S.delete tHash
        chs <- if S.null ths
                then chainHashMap <%= (M.delete cHash)
                else use chainHashMap
        lift . modifyChainHashEntryState_ cHash $ do
          transactions %= S.delete tHash
          when (M.null chs) $ inBlocks %= S.delete bHash
        return (ths,chs)
      if S.null depTXs
        then ffor mPairs $ \(ths,chs) ->
          if S.null ths && M.null chs
            then return Nothing
            else gets Just
        else gets Just
  return Nothing

getChainHashForTxInBlock :: HasRegistry m => SHA -> SHA -> m (Maybe SHA)
getChainHashForTxInBlock bHash tHash = join . fmap (M.lookup tHash . _txHashMap) <$> getBlockHashEntry bHash

getTxHashSetForChainHashInBlock :: HasRegistry m => SHA -> SHA -> m (Maybe (Set SHA))
getTxHashSetForChainHashInBlock bHash cHash = join . fmap (M.lookup cHash . _chainHashMap) <$> getBlockHashEntry bHash
