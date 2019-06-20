{-# LANGUAGE DefaultSignatures             #-}
{-# LANGUAGE FlexibleContexts              #-}
{-# LANGUAGE FlexibleInstances             #-}
{-# LANGUAGE LambdaCase                    #-}
{-# LANGUAGE MultiParamTypeClasses         #-}
{-# LANGUAGE RankNTypes                    #-}
{-# LANGUAGE TemplateHaskell               #-}
{-# LANGUAGE TypeFamilies                  #-}
{-# LANGUAGE TypeApplications              #-}
{-# LANGUAGE TypeOperators                 #-}
{-# LANGUAGE OverloadedStrings             #-}
{-# OPTIONS_GHC -fno-warn-orphans          #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
module Blockchain.Sequencer.Monad (
    SequencerContext(..)
  , SequencerConfig(..)
  , SequencerM
  , HasNamespace(..)
  , isInNamespace
  , fromNamespace
  , lookupInLDB
  , insertInLDB
  , batchInsertInLDB
  , deleteInLDB
  , batchDeleteInLDB
  , genericLookupSequencer
  , genericInsertSequencer
  , genericDeleteSequencer
  , getChainsDB
  , getTransactionsDB
  , prunePrivacyDBs
  , runSequencerM
  , pairToOETx
  , markForVM
  , markForP2P
  , clearLdbBatchOps
  , addLdbBatchOps
  , drainP2P
  , drainVM
  , clearDBERegistry
  , createFirstTimer
  , createNewTimer
  , drainTMChan
  , drainTimeouts
  , drainVotes
  , fuseChannels
  , createWaitTimer
) where

import           Prelude                                   hiding (round)
import           ClassyPrelude                             (atomically, STM)
import           Conduit
import           Control.Concurrent                        (forkIO, threadDelay)
import           Control.Concurrent.AlarmClock
import           Control.Concurrent.STM.TMChan
import           Control.Lens
import           Control.Monad                             (join)
import qualified Control.Monad.Change.Alter                as A
import qualified Control.Monad.Change.Modify               as Mod
import           Control.Monad.Reader
import           Control.Monad.State

import           Data.Binary
import qualified Data.ByteString                           as B
import qualified Data.ByteString.Lazy                      as BL
import           Data.Conduit.TMChan
import           Data.Conduit.TQueue
import           Data.Foldable                             (toList)
import           Data.IORef
import           Data.Map                                  (Map)
import qualified Data.Map                                  as M
import qualified Data.Sequence                             as Q
import qualified Data.Text                                 as T
import           Data.Time.Clock

import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.HTTPAdmin
import           Blockchain.Constants
import           Blockchain.Data.RLP
import           Blockchain.ExtWord                        (Word256)
import           Blockchain.Output
import           Blockchain.Privacy
import           Blockchain.Sequencer.CablePackage
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.DB.GetChainsDB
import           Blockchain.Sequencer.DB.GetTransactionsDB
import           Blockchain.Sequencer.DB.SeenTransactionDB
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Metrics
import           Blockchain.SHA
import           Blockchain.Strato.Model.Class
import           Prometheus
import           System.Directory                          (createDirectoryIfMissing)
import           Text.Format

import qualified Database.LevelDB                          as LDB

data Modification a = Modification a | Deletion

data SequencerContext = SequencerContext
  { _dependentBlockDB    :: DependentBlockDB
  , _seenTransactionDB   :: SeenTransactionDB
  , _dbeRegistry         :: Map SHA DependentBlockEntry
  , _blockHashRegistry   :: Map SHA (Modification OutputBlock)
  , _txHashRegistry      :: Map SHA (Modification OutputTx)
  , _chainHashRegistry   :: Map SHA (Modification ChainHashEntry)
  , _chainIdRegistry     :: Map Word256 (Modification ChainIdEntry)
  , _getChainsDB         :: GetChainsDB
  , _getTransactionsDB   :: GetTransactionsDB
  , _ldbBatchOps         :: Q.Seq LDB.BatchOp
  , _vmEvents            :: Q.Seq OutputEvent
  , _p2pEvents           :: Q.Seq OutputEvent
  , _blockstanbulContext :: Maybe BlockstanbulContext
  , _loopTimeout         :: TMChan ()
  , _latestRoundNumber   :: IORef RoundNumber
  }
makeLenses ''SequencerContext

data SequencerConfig = SequencerConfig
  { depBlockDBCacheSize     :: Int
  , depBlockDBPath          :: String
  , seenTransactionDBSize   :: Int
  , syncWrites              :: Bool
  , blockstanbulBlockPeriod :: NominalDiffTime
  , blockstanbulRoundPeriod :: NominalDiffTime
  , blockstanbulBeneficiary :: TQueue CandidateReceived
  , blockstanbulVoteResps   :: TQueue VoteResult
  , blockstanbulTimeouts    :: TMChan RoundNumber
  , cablePackage            :: CablePackage
  , maxEventsPerIter        :: Int
  , maxUsPerIter            :: Int
  }

type SequencerM  = StateT SequencerContext (ReaderT SequencerConfig (ResourceT (LoggingT IO)))

instance HasDependentBlockDB SequencerM where
  getDependentBlockDB = use dependentBlockDB
  getWriteOptions     = LDB.WriteOptions . syncWrites <$> ask
  getReadOptions      = return LDB.defaultReadOptions

instance Mod.Modifiable GetChainsDB SequencerM where
  get _ = use getChainsDB
  put _ = assign getChainsDB

instance Mod.Modifiable GetTransactionsDB SequencerM where
  get _ = use getTransactionsDB
  put _ = assign getTransactionsDB

instance HasPrivateHashDB SequencerM where
  getChainId = return . hash . rlpSerialize . rlpEncode
  generateInitialChainHash = return . hash . rlpSerialize . rlpEncode
  generateChainHashes tx =
    let r = txSigR tx
        s = txSigS tx
        rs = hash . rlpSerialize $ RLPArray [rlpEncode r, rlpEncode s]
        sr = hash . rlpSerialize $ RLPArray [rlpEncode s, rlpEncode r]
     in return [rs,sr]

  requestChain = insertGetChainsDB
  requestTransaction = insertGetTransactionsDB

instance Mod.Accessible LDB.DB SequencerM where
  access _ = use dependentBlockDB

class HasNamespace a where
  type NSKey a
  namespace :: Mod.Proxy a -> BL.ByteString

  namespaced :: Mod.Proxy a -> NSKey a -> B.ByteString
  default namespaced :: Binary (NSKey a) => Mod.Proxy a -> NSKey a -> B.ByteString
  namespaced p = BL.toStrict . BL.append (namespace p) . encode

isInNamespace :: HasNamespace a => Mod.Proxy a -> BL.ByteString -> Bool
isInNamespace = BL.isPrefixOf . namespace

fromNamespace :: (HasNamespace a, Binary (NSKey a))
              => Mod.Proxy a -> BL.ByteString -> Maybe (NSKey a)
fromNamespace p bs = if isInNamespace p bs
  then Just . decode $ BL.drop (BL.length (namespace p)) bs
  else Nothing

instance HasNamespace OutputBlock where
  type NSKey OutputBlock = SHA
  namespace _ = "bh:"

instance HasNamespace OutputTx where
  type NSKey OutputTx = SHA
  namespace _ = "th:"

instance HasNamespace ChainHashEntry where
  type NSKey ChainHashEntry = SHA
  namespace _ = "ch:"

instance HasNamespace ChainIdEntry where
  type NSKey ChainIdEntry = Word256
  namespace _ = "ci:"

lookupInLDB :: (Binary a, HasNamespace a, MonadIO m, Mod.Accessible LDB.DB m)
            => Mod.Proxy a -> NSKey a -> m (Maybe a)
lookupInLDB p k = Mod.access Mod.Proxy >>= \db ->
  fmap (decode . BL.fromStrict) <$> LDB.get db LDB.defaultReadOptions (namespaced p k)

insertInLDB :: (Binary a, HasNamespace a, MonadIO m, Mod.Accessible LDB.DB m)
            => Mod.Proxy a -> NSKey a -> a -> m ()
insertInLDB p k v = Mod.access Mod.Proxy >>= \db ->
  LDB.put db LDB.defaultWriteOptions (namespaced p k) (BL.toStrict $ encode v)

batchInsertInLDB :: (Binary a, HasNamespace a) => Mod.Proxy a -> NSKey a -> a -> LDB.BatchOp
batchInsertInLDB p k v = LDB.Put (namespaced p k) (BL.toStrict $ encode v)

deleteInLDB :: (HasNamespace a, MonadIO m, Mod.Accessible LDB.DB m)
            => Mod.Proxy a -> NSKey a -> m ()
deleteInLDB p k = Mod.access Mod.Proxy >>= \db ->
  LDB.delete db LDB.defaultWriteOptions (namespaced p k)

batchDeleteInLDB :: HasNamespace a
                 => Mod.Proxy a -> NSKey a -> LDB.BatchOp
batchDeleteInLDB p k = LDB.Del (namespaced p k)

genericLookupSequencer :: (Ord (NSKey a), Binary a, HasNamespace a)
                       => Lens' SequencerContext (Map (NSKey a) (Modification a))
                       -> Mod.Proxy a
                       -> NSKey a
                       -> SequencerM (Maybe a)
genericLookupSequencer registry p k = use (registry . at k) >>= \case
  Just Deletion -> return Nothing
  Just (Modification a) -> return $ Just a
  Nothing -> lookupInLDB p k >>= \case
    Nothing -> return Nothing
    Just a -> do
      registry . at k ?= Modification a
      return $ Just a

genericInsertSequencer :: (Ord (NSKey a), Binary a, HasNamespace a)
                       => Lens' SequencerContext (Map (NSKey a) (Modification a))
                       -> Mod.Proxy a
                       -> NSKey a
                       -> a
                       -> SequencerM ()
genericInsertSequencer registry p k a = do
  registry . at k ?= Modification a
  addLdbBatchOps . (:[]) $ batchInsertInLDB p k a

genericDeleteSequencer :: (Ord (NSKey a), HasNamespace a)
                       => Lens' SequencerContext (Map (NSKey a) (Modification a))
                       -> Mod.Proxy a
                       -> NSKey a
                       -> SequencerM ()
genericDeleteSequencer registry p k = do
  registry . at k ?= Deletion
  addLdbBatchOps . (:[]) $ batchDeleteInLDB p k

instance (SHA `A.Alters` OutputBlock) SequencerM where
  lookup = genericLookupSequencer blockHashRegistry
  insert p k v = do
    genericInsertSequencer blockHashRegistry p k v
    sz <- M.size <$> use blockHashRegistry
    liftIO $ withLabel blockHashRegistrySize "block_hash_registry" (flip setGauge (fromIntegral sz))
  delete p k = do
    genericDeleteSequencer blockHashRegistry p k
    sz <- M.size <$> use blockHashRegistry
    liftIO $ withLabel blockHashRegistrySize "block_hash_registry" (flip setGauge (fromIntegral sz))

instance (SHA `A.Alters` OutputTx) SequencerM where
  lookup = genericLookupSequencer txHashRegistry
  insert p k v = do
    genericInsertSequencer txHashRegistry p k v
    sz <- M.size <$> use txHashRegistry
    liftIO $ withLabel txHashRegistrySize "tx_hash_registry" (flip setGauge (fromIntegral sz))
  delete p k = do
    genericDeleteSequencer txHashRegistry p k
    sz <- M.size <$> use txHashRegistry
    liftIO $ withLabel txHashRegistrySize "tx_hash_registry" (flip setGauge (fromIntegral sz))

instance (SHA `A.Alters` ChainHashEntry) SequencerM where
  lookup = genericLookupSequencer chainHashRegistry
  insert p k v = do
    genericInsertSequencer chainHashRegistry p k v
    sz <- M.size <$> use chainHashRegistry
    liftIO $ withLabel chainHashRegistrySize "chain_hash_registry" (flip setGauge (fromIntegral sz))
  delete p k = do
    genericDeleteSequencer chainHashRegistry p k
    sz <- M.size <$> use chainHashRegistry
    liftIO $ withLabel chainHashRegistrySize "chain_hash_registry" (flip setGauge (fromIntegral sz))

instance (Word256 `A.Alters` ChainIdEntry) SequencerM where
  lookup = genericLookupSequencer chainIdRegistry
  insert p k v = do
    genericInsertSequencer chainIdRegistry p k v
    sz <- M.size <$> use chainIdRegistry
    liftIO $ withLabel chainIdRegistrySize "chain_id_registry" (flip setGauge (fromIntegral sz))
  delete p k = do
    genericDeleteSequencer chainIdRegistry p k
    sz <- M.size <$> use chainIdRegistry
    liftIO $ withLabel chainIdRegistrySize "chain_id_registry" (flip setGauge (fromIntegral sz))

instance (SHA `A.Alters` DependentBlockEntry) SequencerM where
  lookup _ k = do
    mv <- use $ dbeRegistry . at k
    case mv of
      Just v -> return $ Just v
      Nothing -> genericLookupDependentBlockDB k
  insert _ k v = do
    dbeRegistry . at k ?= v
    addLdbBatchOps . (:[]) $ genericBatchInsertDependentBlockDB k v
  delete _ k = do
    dbeRegistry . at k .= Nothing
    addLdbBatchOps . (:[]) $ genericBatchDeleteDependentBlockDB k

instance Mod.Modifiable SeenTransactionDB SequencerM where
  get _ = use seenTransactionDB
  put _ = assign seenTransactionDB

instance (SHA `A.Alters` ()) SequencerM where
  lookup _ = genericLookupSeenTransactionDB
  insert _ = genericInsertSeenTransactionDB
  delete _ = genericDeleteSeenTransactionDB

instance HasBlockstanbulContext SequencerM where
  getBlockstanbulContext = use blockstanbulContext
  putBlockstanbulContext = assign (blockstanbulContext . _Just)

prunePrivacyDBs :: SequencerM ()
prunePrivacyDBs = do
  prune blockHashRegistry
  prune txHashRegistry
  prune chainHashRegistry
  prune chainIdRegistry
  where prune = flip (%=) . M.mapMaybe $ \case
          Modification a -> Just $ Modification a
          Deletion       -> Nothing

runSequencerM :: SequencerConfig -> Maybe BlockstanbulContext -> SequencerM a -> (LoggingT IO) a
runSequencerM c mbc m = do
    liftIO $ createDirectoryIfMissing False $ dbDir "h"
    a <- runResourceT . flip runReaderT c $ do
        dbCS     <- asks depBlockDBCacheSize
        dbPath   <- asks depBlockDBPath
        stxSize  <- asks seenTransactionDBSize
        depBlock <- LDB.open dbPath LDB.defaultOptions { LDB.createIfMissing = True, LDB.cacheSize=dbCS }
        loopCh <- atomically newTMChan
        latestRound <- liftIO $ newIORef 0
        runStateT m SequencerContext
            { _dependentBlockDB    = depBlock
            , _seenTransactionDB   = mkSeenTxDB stxSize
            , _dbeRegistry         = M.empty
            , _blockHashRegistry   = M.empty
            , _txHashRegistry      = M.empty
            , _chainHashRegistry   = M.empty
            , _chainIdRegistry     = M.empty
            , _getChainsDB         = emptyGetChainsDB
            , _getTransactionsDB   = emptyGetTransactionsDB
            , _ldbBatchOps         = Q.empty
            , _vmEvents            = Q.empty
            , _p2pEvents           = Q.empty
            , _blockstanbulContext = mbc
            , _loopTimeout         = loopCh
            , _latestRoundNumber   = latestRound
            }
    return $ fst a

pairToOETx :: (Timestamp, OutputTx) -> OutputEvent
pairToOETx = uncurry OETx

markForVM :: OutputEvent -> SequencerM ()
markForVM oe = vmEvents %= (Q.|> oe)

markForP2P :: OutputEvent -> SequencerM ()
markForP2P oe = p2pEvents %= (Q.|> oe)

drainP2P :: SequencerM [OutputEvent]
drainP2P = fmap toList $ p2pEvents <<.= Q.empty

drainVM :: SequencerM [OutputEvent]
drainVM = fmap toList $ vmEvents <<.= Q.empty

clearDBERegistry :: SequencerM ()
clearDBERegistry = dbeRegistry .= M.empty

createFirstTimer :: SequencerM ()
createFirstTimer = do
  v <- currentView
  createNewTimer . _round $ v

createNewTimer :: RoundNumber -> SequencerM ()
createNewTimer rn = do
  rnref <- use latestRoundNumber
  liftIO $ atomicModifyIORef' rnref (\x -> (max rn x, ()))
  ch <- asks blockstanbulTimeouts
  dt <- asks blockstanbulRoundPeriod
  let act :: AlarmClock UTCTime -> IO ()
      act this' = do
        atomically $ writeTMChan ch rn
        globalRN <- readIORef rnref
        -- The first RoundChange for this message may have not
        -- been seen, so we keep firing at the same interval
        -- until an alarm lands and the round changes
        unless (globalRN > rn) $ do
          next <- addUTCTime dt <$> getCurrentTime
          setAlarm this' next
  alarm <- liftIO $ newAlarmClock act
  next <- addUTCTime dt <$> liftIO getCurrentTime
  liftIO $ setAlarm alarm next

drainTMChan :: TMChan a -> STM [a]
drainTMChan ch = do
  mx <- join <$> tryReadTMChan ch
  case mx of
    Nothing -> return []
    Just x  -> (x:) <$> drainTMChan ch

drainTimeouts :: SequencerM [RoundNumber]
drainTimeouts = join $ asks (atomically . drainTMChan . blockstanbulTimeouts)

drainVotes :: SequencerM [CandidateReceived]
drainVotes = atomically . flushTQueue =<< asks blockstanbulBeneficiary

clearLdbBatchOps :: SequencerM ()
clearLdbBatchOps = modify (\st -> st{_ldbBatchOps = Q.empty})

addLdbBatchOps :: [LDB.BatchOp] -> SequencerM ()
addLdbBatchOps ops = do
  existingOps <- use ldbBatchOps
  let newOps = foldl (Q.|>) existingOps ops
  ldbBatchOps .= newOps

fuseChannels ::SequencerM (ConduitM () SeqLoopEvent SequencerM ())
fuseChannels = do
  unseq <- asks $ unseqEvents . cablePackage
  votes <- asks blockstanbulBeneficiary
  timers <- asks blockstanbulTimeouts
  loop <- use loopTimeout
  let debugLog = (.| iterMC ($logDebugS "fuseChannels" . T.pack . format))
  (debugLog . transPipe lift) <$> mergeSources
               [ sourceTQueue unseq .| mapC UnseqEvent
               , sourceTQueue votes .| mapC VoteMade
               , sourceTMChan timers .| mapC TimerFire
               , sourceTMChan loop .| mapC (const WaitTerminated)]
               4096 -- 🙏

createWaitTimer :: Int -> SequencerM ()
createWaitTimer dt = do
    lch <- use loopTimeout
    $logDebugS "createWaitTimer" . T.pack . show $ dt
    void . liftIO . forkIO $ do
      threadDelay dt
      atomically (writeTMChan lch ())
