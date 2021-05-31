{-# LANGUAGE ConstraintKinds               #-}
{-# LANGUAGE DefaultSignatures             #-}
{-# LANGUAGE FlexibleContexts              #-}
{-# LANGUAGE FlexibleInstances             #-}
{-# LANGUAGE LambdaCase                    #-}
{-# LANGUAGE MultiParamTypeClasses         #-}
{-# LANGUAGE RankNTypes                    #-}
{-# LANGUAGE RecordWildCards               #-}
{-# LANGUAGE TemplateHaskell               #-}
{-# LANGUAGE TypeFamilies                  #-}
{-# LANGUAGE TypeApplications              #-}
{-# LANGUAGE TypeOperators                 #-}
{-# LANGUAGE OverloadedStrings             #-}
{-# OPTIONS_GHC -fno-warn-orphans          #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
module Blockchain.Sequencer.Monad
  ( MonadBlockstanbul
  , Modification(..)
  , SequencerContext(..)
  , SequencerConfig(..)
  , SequencerM
  , HasNamespace(..)
  , BlockPeriod(..)
  , RoundPeriod(..)
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
  , prunePrivacyDBs
  , runSequencerM
  , pairToVmTx
  , clearLdbBatchOps
  , flushLdbBatchOps
  , addLdbBatchOps
  , clearDBERegistry
  , createFirstTimer
  , createNewTimer
  , drainTMChan
  , drainTimeouts
  , drainVotes
  , fuseChannels
  , createWaitTimer
  , dependentBlockDB
  , seenTransactionDB
  , dbeRegistry
  , blockHashRegistry
  , emittedBlockRegistry
  , txHashRegistry
  , chainHashRegistry
  , chainIdRegistry
  , getChainsDB
  , getTransactionsDB
  , ldbBatchOps
  , blockstanbulContext
  , loopTimeout
  , latestRoundNumber
) where

import           Prelude                                   hiding (round)
import           ClassyPrelude                             (atomically, STM)
import           Conduit
import           Control.Concurrent                        (forkIO, threadDelay)
import           Control.Concurrent.AlarmClock
import           Control.Concurrent.STM.TMChan
import           Control.Lens
import           Control.Monad                             (join)
import           Control.Monad.FT                          as FT
import           Control.Monad.Reader
import           Control.Monad.State

import           Data.Binary
import qualified Data.ByteString                           as B
import qualified Data.ByteString.Base16                    as B16
import qualified Data.ByteString.Char8                     as C8
import qualified Data.ByteString.Lazy                      as BL
import           Data.Conduit.TMChan
import           Data.Conduit.TQueue
import           Data.Foldable                             (foldl',toList)
import           Data.IORef
import           Data.Map                                  (Map)
import qualified Data.Map                                  as M
import           Data.Maybe
import           Data.Proxy
import qualified Data.Sequence                             as Q
import qualified Data.Text                                 as T
import           Data.Time.Clock
import qualified Database.LevelDB                          as LDB

import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.HTTPAdmin
import           Blockchain.Constants
import           Blockchain.Data.ChainInfo
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
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1
import           Prometheus
import           System.Directory                          (createDirectoryIfMissing)
import           Text.Format

import           Servant.Client
import qualified Strato.Strato23.API.Types                 as VC hiding (Address(..))
import qualified Strato.Strato23.Client                    as VC




data Modification a = Modification a | Deletion

data SequencerContext = SequencerContext
  { _dependentBlockDB    :: DependentBlockDB
  , _seenTransactionDB   :: !SeenTransactionDB
  , _dbeRegistry         :: !(Map Keccak256 DependentBlockEntry)
  , _blockHashRegistry   :: !(Map Keccak256 (Modification OutputBlock))
  , _emittedBlockRegistry :: !(Map Keccak256 (Modification EmittedBlock))
  , _txHashRegistry      :: !(Map Keccak256 (Modification OutputTx))
  , _chainHashRegistry   :: !(Map Keccak256 (Modification ChainHashEntry))
  , _chainIdRegistry     :: !(Map Word256 (Modification ChainIdEntry))
  , _getChainsDB         :: !GetChainsDB
  , _getTransactionsDB   :: !GetTransactionsDB
  , _ldbBatchOps         :: !(Q.Seq LDB.BatchOp)
  , _blockstanbulContext :: Maybe BlockstanbulContext
  , _loopTimeout         :: TMChan ()
  , _latestRoundNumber   :: IORef RoundNumber
  }
makeLenses ''SequencerContext

type MonadBlockstanbul m = ( MonadIO m
                           , HasBlockstanbulContext m
                           , Gettable (IORef RoundNumber) m
                           , Gettable (TMChan RoundNumber) m
                           , Gettable BlockPeriod m
                           , Gettable RoundPeriod m
                           , Gettable (TQueue VoteResult) m
                           , HasVault m
                           )

newtype BlockPeriod = BlockPeriod { unBlockPeriod :: NominalDiffTime }
newtype RoundPeriod = RoundPeriod { unRoundPeriod :: NominalDiffTime }

data SequencerConfig = SequencerConfig
  { depBlockDBCacheSize     :: Int
  , depBlockDBPath          :: String
  , seenTransactionDBSize   :: Int
  , syncWrites              :: Bool
  , blockstanbulBlockPeriod :: BlockPeriod
  , blockstanbulRoundPeriod :: RoundPeriod
  , blockstanbulBeneficiary :: TQueue CandidateReceived
  , blockstanbulVoteResps   :: TQueue VoteResult
  , blockstanbulTimeouts    :: TMChan RoundNumber
  , cablePackage            :: CablePackage
  , maxEventsPerIter        :: Int
  , maxUsPerIter            :: Int
  , vaultClient             :: Maybe ClientEnv -- Nothing in tests
  }

type SequencerM  = StateT SequencerContext (ReaderT SequencerConfig (ResourceT (LoggingT IO)))

instance HasDependentBlockDB SequencerM where
  getDependentBlockDB = use dependentBlockDB
  getWriteOptions     = LDB.WriteOptions . syncWrites <$> ask
  getReadOptions      = return LDB.defaultReadOptions

instance Gettable GetChainsDB SequencerM where
  get = use getChainsDB
instance Puttable GetChainsDB SequencerM where
  put g = modify' $ getChainsDB .~ g
instance Modifiable GetChainsDB SequencerM where

instance Gettable GetTransactionsDB SequencerM where
  get   = use getTransactionsDB
instance Puttable GetTransactionsDB SequencerM where
  put g = modify' $ getTransactionsDB .~ g
instance Modifiable GetTransactionsDB SequencerM where

instance HasPrivateHashDB SequencerM where
  requestChain = insertGetChainsDB
  requestTransaction = insertGetTransactionsDB

instance Gettable LDB.DB SequencerM where
  get = use dependentBlockDB

class HasNamespace a where
  type NSKey a
  namespace :: Proxy a -> BL.ByteString

  namespaced :: Proxy a -> NSKey a -> B.ByteString
  default namespaced :: Binary (NSKey a) => Proxy a -> NSKey a -> B.ByteString
  namespaced p = BL.toStrict . BL.append (namespace p) . encode

isInNamespace :: HasNamespace a => Proxy a -> BL.ByteString -> Bool
isInNamespace = BL.isPrefixOf . namespace

fromNamespace :: (HasNamespace a, Binary (NSKey a))
              => Proxy a -> BL.ByteString -> Maybe (NSKey a)
fromNamespace p bs = if isInNamespace p bs
  then Just . decode $ BL.drop (BL.length (namespace p)) bs
  else Nothing

instance HasNamespace OutputBlock where
  type NSKey OutputBlock = Keccak256
  namespace _ = "bh:"

instance HasNamespace EmittedBlock where
  type NSKey EmittedBlock = Keccak256
  namespace _ = "eb:"

instance HasNamespace OutputTx where
  type NSKey OutputTx = Keccak256
  namespace _ = "th:"

instance HasNamespace ChainHashEntry where
  type NSKey ChainHashEntry = Keccak256
  namespace _ = "ch:"

instance HasNamespace ChainIdEntry where
  type NSKey ChainIdEntry = Word256
  namespace _ = "ci:"

lookupInLDB :: (Binary a, HasNamespace a, MonadIO m, Gettable LDB.DB m)
            => Proxy a -> NSKey a -> m (Maybe a)
lookupInLDB p k = FT.get >>= \db ->
  fmap (decode . BL.fromStrict) <$> LDB.get db LDB.defaultReadOptions (namespaced p k)

insertInLDB :: (Binary a, HasNamespace a, MonadIO m, Gettable LDB.DB m)
            => Proxy a -> NSKey a -> a -> m ()
insertInLDB p k v = FT.get >>= \db ->
  LDB.put db LDB.defaultWriteOptions (namespaced p k) (BL.toStrict $ encode v)

batchInsertInLDB :: (Binary a, HasNamespace a) => Proxy a -> NSKey a -> a -> LDB.BatchOp
batchInsertInLDB p k v = LDB.Put (namespaced p k) (BL.toStrict $ encode v)

deleteInLDB :: (HasNamespace a, MonadIO m, Gettable LDB.DB m)
            => Proxy a -> NSKey a -> m ()
deleteInLDB p k = FT.get >>= \db ->
  LDB.delete db LDB.defaultWriteOptions (namespaced p k)

batchDeleteInLDB :: HasNamespace a
                 => Proxy a -> NSKey a -> LDB.BatchOp
batchDeleteInLDB p k = LDB.Del (namespaced p k)

genericLookupSequencer :: (Ord (NSKey a), Binary a, HasNamespace a)
                       => Lens' SequencerContext (Map (NSKey a) (Modification a))
                       -> Proxy a
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
                       -> Proxy a
                       -> NSKey a
                       -> a
                       -> SequencerM ()
genericInsertSequencer registry p k a = do
  modify' $ registry . at k ?~ Modification a
  addLdbBatchOps . (:[]) $ batchInsertInLDB p k a

genericDeleteSequencer :: (Ord (NSKey a), HasNamespace a)
                       => Lens' SequencerContext (Map (NSKey a) (Modification a))
                       -> Proxy a
                       -> NSKey a
                       -> SequencerM ()
genericDeleteSequencer registry p k = do
  modify' $ registry . at k ?~ Deletion
  addLdbBatchOps . (:[]) $ batchDeleteInLDB p k

instance Selectable OutputBlock Keccak256 SequencerM where
  select = genericLookupSequencer blockHashRegistry Proxy
instance Insertable OutputBlock Keccak256 SequencerM where
  insert k v = do
    genericInsertSequencer blockHashRegistry Proxy k v
    sz <- M.size <$> use blockHashRegistry
    liftIO $ withLabel blockHashRegistrySize "block_hash_registry" (flip setGauge (fromIntegral sz))
instance Deletable  OutputBlock Keccak256 SequencerM where
  delete k = do
    genericDeleteSequencer blockHashRegistry Proxy k
    sz <- M.size <$> use blockHashRegistry
    liftIO $ withLabel blockHashRegistrySize "block_hash_registry" (flip setGauge (fromIntegral sz))
instance Alterable  OutputBlock Keccak256 SequencerM where

instance Selectable EmittedBlock Keccak256 SequencerM where
  select = genericLookupSequencer emittedBlockRegistry Proxy
instance Insertable EmittedBlock Keccak256 SequencerM where
  insert k v = do
    genericInsertSequencer emittedBlockRegistry Proxy k v
    sz <- M.size <$> use emittedBlockRegistry
    liftIO $ withLabel emittedBlockRegistrySize "emitted_block_registry" (flip setGauge (fromIntegral sz))
instance Deletable  EmittedBlock Keccak256 SequencerM where
  delete k = do
    genericDeleteSequencer emittedBlockRegistry Proxy k
    sz <- M.size <$> use emittedBlockRegistry
    liftIO $ withLabel emittedBlockRegistrySize "emitted_block_registry" (flip setGauge (fromIntegral sz))
instance Alterable  EmittedBlock Keccak256 SequencerM where

instance Selectable OutputTx Keccak256 SequencerM where
  select = genericLookupSequencer txHashRegistry Proxy
instance Insertable OutputTx Keccak256 SequencerM where
  insert k v = do
    genericInsertSequencer txHashRegistry Proxy k v
    sz <- M.size <$> use txHashRegistry
    liftIO $ withLabel txHashRegistrySize "tx_hash_registry" (flip setGauge (fromIntegral sz))
instance Deletable  OutputTx Keccak256 SequencerM where
  delete k = do
    genericDeleteSequencer txHashRegistry Proxy k
    sz <- M.size <$> use txHashRegistry
    liftIO $ withLabel txHashRegistrySize "tx_hash_registry" (flip setGauge (fromIntegral sz))
instance Alterable  OutputTx Keccak256 SequencerM where

instance Selectable ChainHashEntry Keccak256 SequencerM where
  select = genericLookupSequencer chainHashRegistry Proxy
instance Insertable ChainHashEntry Keccak256 SequencerM where
  insert k v = do
    genericInsertSequencer chainHashRegistry Proxy k v
    sz <- M.size <$> use chainHashRegistry
    liftIO $ withLabel chainHashRegistrySize "chain_hash_registry" (flip setGauge (fromIntegral sz))
instance Deletable  ChainHashEntry Keccak256 SequencerM where
  delete k = do
    genericDeleteSequencer chainHashRegistry Proxy k
    sz <- M.size <$> use chainHashRegistry
    liftIO $ withLabel chainHashRegistrySize "chain_hash_registry" (flip setGauge (fromIntegral sz))
instance Alterable  ChainHashEntry Keccak256 SequencerM where

instance Selectable ChainIdEntry Word256 SequencerM where
  select = genericLookupSequencer chainIdRegistry Proxy
instance Insertable ChainIdEntry Word256 SequencerM where
  insert k v = do
    genericInsertSequencer chainIdRegistry Proxy k v
    sz <- M.size <$> use chainIdRegistry
    liftIO $ withLabel chainIdRegistrySize "chain_id_registry" (flip setGauge (fromIntegral sz))
instance Deletable  ChainIdEntry Word256 SequencerM where
  delete k = do
    genericDeleteSequencer chainIdRegistry Proxy k
    sz <- M.size <$> use chainIdRegistry
    liftIO $ withLabel chainIdRegistrySize "chain_id_registry" (flip setGauge (fromIntegral sz))
instance Alterable  ChainIdEntry Word256 SequencerM where

instance Selectable DependentBlockEntry Keccak256 SequencerM where
  select k = do
    mv <- use $ dbeRegistry . at k
    case mv of
      Just v -> return $ Just v
      Nothing -> genericLookupDependentBlockDB k
instance Insertable DependentBlockEntry Keccak256 SequencerM where
  insert k v = do
    modify' $ dbeRegistry . at k ?~ v
    addLdbBatchOps . (:[]) $ genericBatchInsertDependentBlockDB k v
instance Deletable  DependentBlockEntry Keccak256 SequencerM where
  delete k = do
    modify' $ dbeRegistry . at k .~ Nothing
    addLdbBatchOps . (:[]) $ genericBatchDeleteDependentBlockDB k
instance Alterable  DependentBlockEntry Keccak256 SequencerM where

instance Selectable ParentChainId (Maybe Word256) SequencerM where
  select = \case
    Nothing -> pure . Just $ ParentChainId Nothing
    Just cId -> join . fmap (fmap (ParentChainId . parentChain . chainInfo) . _chainIdInfo) <$> select @ChainIdEntry cId

instance Gettable SeenTransactionDB SequencerM where
  get = use seenTransactionDB
instance Puttable SeenTransactionDB SequencerM where
  put = modify' . (.~) seenTransactionDB
instance Modifiable SeenTransactionDB SequencerM where

instance Gettable (Q.Seq LDB.BatchOp) SequencerM where
  get = use ldbBatchOps
instance Puttable (Q.Seq LDB.BatchOp) SequencerM where
  put = modify' . (.~) ldbBatchOps
instance Modifiable (Q.Seq LDB.BatchOp) SequencerM where

instance Gettable (IORef RoundNumber) SequencerM where
  get = use latestRoundNumber

instance Gettable (TMChan RoundNumber) SequencerM where
  get = asks blockstanbulTimeouts

instance Gettable BlockPeriod SequencerM where
  get = asks blockstanbulBlockPeriod

instance Gettable RoundPeriod SequencerM where
  get = asks blockstanbulRoundPeriod

instance Gettable (TQueue CandidateReceived) SequencerM where
  get = asks blockstanbulBeneficiary

instance Gettable (TQueue VoteResult) SequencerM where
  get = asks blockstanbulVoteResps

instance Gettable View SequencerM where
  get = currentView

instance Selectable () Keccak256 SequencerM where
  select = genericLookupSeenTransactionDB
instance Insertable () Keccak256 SequencerM where
  insert = genericInsertSeenTransactionDB
instance Deletable  () Keccak256 SequencerM where
  delete = genericDeleteSeenTransactionDB
instance Alterable  () Keccak256 SequencerM where

instance HasBlockstanbulContext SequencerM where
  getBlockstanbulContext = use blockstanbulContext
  putBlockstanbulContext = modify' . (.~) (blockstanbulContext . _Just)


-- If there is no vault client (i.e. in hspec tests), the HasVault instance will use this key, 
-- I know, it's ugly...the SequencerSpec test uses SequencerM itself, so this was a lot 
-- easier than making a whole new SequencerM definition just to get a different HasVault instance
testPriv :: PrivateKey
testPriv = fromMaybe (error "could not import private key") (importPrivateKey (fst $ B16.decode $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))

instance HasVault SequencerM where
  sign mesg = do
    mVc <- asks vaultClient    
    case mVc of
      Nothing -> return $ signMsg testPriv mesg
      Just vc -> waitOnVault $ liftIO $ runClientM (VC.postSignature (T.pack "nodekey") (VC.MsgHash mesg)) vc

  getPub = error "called getPub in SequencerM, but this should never happen"
  getShared _ = error "called getShared in SequencerM, but this should never happen"

waitOnVault :: (Show a) => SequencerM (Either a b) -> SequencerM b
waitOnVault action = do
  $logInfoS "HasVault" "Asking the vault-wrapper to sign a Blockstanbul message"
  res <- action
  case res of
    Left err -> do 
      $logErrorS "HasVault" . T.pack $ "failed to get signature from vault...got: " ++ (show err)
      liftIO $ threadDelay 2000000 -- 2 seconds
      waitOnVault action
    Right val -> do 
      $logInfoS "HasVault" "Got a signature from vault" 
      return val

initialEmittedBlockCache :: Map Keccak256 (Modification EmittedBlock)
initialEmittedBlockCache = M.singleton zeroHash $ Modification alreadyEmittedBlock

prunePrivacyDBs :: SequencerM ()
prunePrivacyDBs = do
  prune blockHashRegistry
  prune txHashRegistry
  prune chainHashRegistry
  prune chainIdRegistry
  setTo initialEmittedBlockCache emittedBlockRegistry
  where prune = setTo M.empty
        setTo s r = modify' $ r .~ s

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
            , _emittedBlockRegistry = initialEmittedBlockCache
            , _txHashRegistry      = M.empty
            , _chainHashRegistry   = M.empty
            , _chainIdRegistry     = M.empty
            , _getChainsDB         = emptyGetChainsDB
            , _getTransactionsDB   = emptyGetTransactionsDB
            , _ldbBatchOps         = Q.empty
            , _blockstanbulContext = mbc
            , _loopTimeout         = loopCh
            , _latestRoundNumber   = latestRound
            }
    return $ fst a

pairToVmTx :: (Timestamp, OutputTx) -> VmEvent
pairToVmTx = uncurry VmTx

clearDBERegistry :: SequencerM ()
clearDBERegistry = modify' $ dbeRegistry .~ M.empty

createFirstTimer :: ( MonadBlockstanbul m
                    , Gettable View m
                    )
                 => m ()
createFirstTimer = do
  v <- FT.get
  createNewTimer . _round $ v

createNewTimer :: MonadBlockstanbul m
               => RoundNumber
               -> m ()
createNewTimer rn = do
  rnref <- FT.get @(IORef RoundNumber)
  liftIO $ atomicModifyIORef' rnref (\x -> (max rn x, ()))
  ch <- FT.get @(TMChan RoundNumber)
  dt <- unRoundPeriod <$> FT.get @(RoundPeriod)
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

clearLdbBatchOps :: Puttable (Q.Seq LDB.BatchOp) m => m ()
clearLdbBatchOps = FT.put @(Q.Seq LDB.BatchOp) Q.empty

flushLdbBatchOps :: SequencerM ()
flushLdbBatchOps = do
  pendingLDBWrites <- use ldbBatchOps
  applyLDBBatchWrites $ toList pendingLDBWrites
  incCounter seqLdbBatchWrites
  setGauge seqLdbBatchSize . fromIntegral $ length pendingLDBWrites
  $logInfoS "flushLdbBatchOps" "Applied pending LDB writes"
  clearLdbBatchOps

addLdbBatchOps :: Modifiable (Q.Seq LDB.BatchOp) m => [LDB.BatchOp] -> m ()
addLdbBatchOps ops = modifyPure_ @(Q.Seq LDB.BatchOp) $ \existingOps ->
  foldl' (Q.|>) existingOps ops

fuseChannels ::SequencerM (ConduitM () SeqLoopEvent SequencerM ())
fuseChannels = do
  unseq <- asks $ unseqEvents . cablePackage
  votes <- asks blockstanbulBeneficiary
  timers <- asks blockstanbulTimeouts
  loop <- use loopTimeout
  let debugLog = (.| iterMC ($logDebugS "fuseChannels" . T.pack . format))
  (debugLog . transPipe lift) <$> mergeSources
               [ sourceTBQueue unseq .| mapC UnseqEvent
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
