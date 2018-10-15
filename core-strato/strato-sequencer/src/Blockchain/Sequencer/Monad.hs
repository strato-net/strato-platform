{-# LANGUAGE FlexibleContexts               #-}
{-# LANGUAGE FlexibleInstances              #-}
{-# LANGUAGE MultiParamTypeClasses          #-}
{-# LANGUAGE TemplateHaskell                #-}
{-# LANGUAGE OverloadedStrings              #-}
{-# OPTIONS_GHC -fno-warn-orphans           #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds  #-}
module Blockchain.Sequencer.Monad (
    SequencerContext(..)
  , SequencerConfig(..)
  , SequencerM
  , runSequencerM
  , pairToOETx
  , markForVM
  , markForP2P
  , clearLdbBatchOps
  , addLdbBatchOps
  , drainP2P
  , drainVM
  , createFirstTimer
  , createNewTimer
  , drainTMChan
  , drainTimeouts
  , drainVotes
  , fuseChannels
  , createWaitTimer
) where

import           ClassyPrelude                             (atomically, STM, threadDelay)
import           Prelude                                   hiding (round)
import           Control.Concurrent                        (forkIO)
import           Control.Concurrent.AlarmClock
import           Control.Concurrent.STM.TMChan
import           Control.Lens
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.State
import           Control.Monad.Trans.Resource

import           Conduit
import           Data.Conduit.TMChan
import           Data.Foldable                             (toList)
import           Data.IORef
import qualified Data.Sequence                             as Q
import qualified Data.Set                                  as S
import qualified Data.Text                                 as T
import           Data.Time.Clock

import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.HTTPAdmin
import           Blockchain.Constants
import           Blockchain.ExtWord                        (Word256)
import           Blockchain.Sequencer.CablePackage
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.DB.GetChainsDB
import           Blockchain.Sequencer.DB.GetTransactionsDB
import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.SeenBlockDB
import           Blockchain.Sequencer.DB.SeenTransactionDB
import           Blockchain.Sequencer.Event
import           Blockchain.SHA
import           System.Directory                          (createDirectoryIfMissing)

import qualified Database.LevelDB                          as LDB

data SequencerContext = SequencerContext
                      { _dependentBlockDB    :: DependentBlockDB
                      , _seenBlockDB         :: SeenBlockDB
                      , _seenTransactionDB   :: SeenTransactionDB
                      , _privateHashDB       :: PrivateHashDB
                      , _getChainsDB         :: S.Set Word256
                      , _getTransactionsDB   :: S.Set SHA
                      , _ldbBatchOps         :: Q.Seq LDB.BatchOp
                      , _vmEvents            :: Q.Seq OutputEvent
                      , _p2pEvents           :: Q.Seq OutputEvent
                      , _blockstanbulContext :: Maybe BlockstanbulContext
                      , _loopTimeout         :: TMChan ()
                      , _latestRoundNumber   :: IORef RoundNumber
                      }
makeLenses ''SequencerContext


data SequencerConfig =
     SequencerConfig { depBlockDBCacheSize     :: Int
                     , depBlockDBPath          :: String
                     , seenTransactionDBSize   :: Int
                     , syncWrites              :: Bool
                     , blockstanbulBlockPeriod :: NominalDiffTime
                     , blockstanbulRoundPeriod :: NominalDiffTime
                     , blockstanbulBeneficiary :: TMChan CandidateReceived
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

instance HasGetChainsDB SequencerM where
    getGetChainsDB = use getChainsDB
    putGetChainsDB = assign getChainsDB

instance HasGetTransactionsDB SequencerM where
    getGetTransactionsDB = use getTransactionsDB
    putGetTransactionsDB = assign getTransactionsDB

instance HasPrivateHashDB SequencerM where
    getPrivateHashDB = use privateHashDB
    putPrivateHashDB = assign privateHashDB

instance HasSeenBlockDB SequencerM where
    getSeenBlockDB = use seenBlockDB
    putSeenBlockDB = assign seenBlockDB

instance HasSeenTransactionDB SequencerM where
    getSeenTransactionDB = use seenTransactionDB
    putSeenTransactionDB = assign seenTransactionDB

instance HasBlockstanbulContext SequencerM where
    getBlockstanbulContext = use blockstanbulContext
    putBlockstanbulContext = assign (blockstanbulContext . _Just)

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
            , _seenBlockDB         = mkSeenBlockDB stxSize
            , _seenTransactionDB   = mkSeenTxDB stxSize
            , _privateHashDB       = emptyPrivateHashDB
            , _getChainsDB         = S.empty
            , _getTransactionsDB   = S.empty
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
      act this = do
        atomically $ writeTMChan ch rn
        globalRN <- readIORef rnref
        -- The first RoundChange for this message may have not
        -- been seen, so we keep firing at the same interval
        -- until an alarm lands and the round changes
        unless (globalRN > rn) $ do
          next <- addUTCTime dt <$> getCurrentTime
          setAlarm this next
  alarm <- liftIO $ newAlarmClock act
  next <- addUTCTime dt <$> liftIO getCurrentTime
  liftIO $ setAlarm alarm next

drainTMChan :: TMChan a -> STM [a]
drainTMChan ch = do
  mmx <- tryReadTMChan ch
  case mmx of
    Nothing -> return []
    Just Nothing -> return []
    Just (Just x) -> (x:) <$> drainTMChan ch

drainTimeouts :: SequencerM [RoundNumber]
drainTimeouts = join $ asks (atomically . drainTMChan . blockstanbulTimeouts)

drainVotes :: SequencerM [CandidateReceived]
drainVotes = atomically . drainTMChan =<< asks blockstanbulBeneficiary

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
  let debugLog = (.| iterMC ($logDebugS "fuseChannels" . T.pack . show))
  debugLog <$> mergeSources [ sourceTMChan unseq .| mapC UnseqEvent
                            , sourceTMChan votes .| mapC VoteMade
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
