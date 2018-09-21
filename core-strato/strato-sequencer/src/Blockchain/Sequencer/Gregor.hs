-- Gregor (Samsa) is an indedpendent Monad from SequencerM, for the purpose of
-- communicating with Kafka. This can be thought of a layer above Sequencer.Kafka,
-- to abstract communication away from SequencerM. This has two immediate gains:
-- the sequencer becomes more testable as it does not require a kafka setup to run,
-- and the sequencer does not have to worry about long blocking reads from kafka
-- preventing other events from being processed.
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
module Blockchain.Sequencer.Gregor
  (
    GregorConfig(..)
  , runTheGregor
  , runGregorM
  , assertTopicCreation
  , writeSeqP2pEvents
  , writeSeqVmEvents
  ) where

import           ClassyPrelude              (atomically, TMChan, writeTMChan, STM, tryReadTMChan, peekTMChan)
import           Control.Concurrent.Async.Lifted (race)
import           Control.Lens               hiding (op)
import           Control.Monad.State
import           Control.Monad.Logger
import           Control.Monad.Trans.Resource
import qualified Data.Text as T
import qualified Prometheus as P

import qualified Blockchain.EthConf                        as EC
import qualified Blockchain.MilenaTools     as K
import           Blockchain.Output
import           Blockchain.Sequencer.CablePackage
import           Blockchain.Sequencer.Event
import qualified Blockchain.Sequencer.Kafka as SK
import           Blockchain.Sequencer.Metrics
import qualified Network.Kafka              as K
import qualified Network.Kafka.Protocol     as KP

data GregorConfig = GregorConfig
                  { kafkaAddress :: Maybe K.KafkaAddress
                  , kafkaClientId :: K.KafkaClientId
                  , kafkaConsumerGroup :: KP.ConsumerGroup
                  , cablePackage :: CablePackage
                  }


data GregorContext = GregorContext
                     { _gregorKafkaState :: K.KafkaState
                     , _gregorConsumerGroup :: KP.ConsumerGroup
                     , _gregorUnseq :: TMChan IngestEvent
                     , _gregorSeqP2P :: TMChan OutputEvent
                     , _gregorSeqVM :: TMChan OutputEvent
                     }
makeLenses ''GregorContext

type GregorM = StateT GregorContext (ResourceT (LoggingT IO))

convert :: GregorConfig -> GregorContext
convert GregorConfig{..} =
  let kState = case kafkaAddress of
                  Nothing -> EC.mkConfiguredKafkaState kafkaClientId
                  Just addr -> K.mkKafkaState kafkaClientId addr
  in GregorContext { _gregorKafkaState = kState
                   , _gregorConsumerGroup = kafkaConsumerGroup
                   , _gregorUnseq = unseqEvents cablePackage
                   , _gregorSeqP2P = seqP2PEvents cablePackage
                   , _gregorSeqVM = seqVMEvents cablePackage
                   }

runGregorM :: GregorConfig -> GregorM a -> IO a
runGregorM cfg = flip runLoggingT printLogMsg
               . runResourceT
               . flip evalStateT (convert cfg)

instance K.HasKafkaState GregorM where
  getKafkaState = use gregorKafkaState
  putKafkaState = assign gregorKafkaState

instance P.MonadMonitor GregorM where
  doIO = liftIO

getKafkaConsumerGroup :: GregorM KP.ConsumerGroup
getKafkaConsumerGroup = use gregorConsumerGroup

readUnseqEvents' :: GregorM [(KP.Offset, IngestEvent)]
readUnseqEvents' = do
    offset <- getNextIngestedOffset
    $logInfoS "readUnseqEvents'" . T.pack $ "Fetching unseqevents from " ++ show offset
    -- its really [(nextOffset, eventAtThisOffset)]
    ret <- zip [(offset+1)..] <$> K.withKafkaRetry1s (SK.readUnseqEvents offset)
    P.unsafeAddCounter (fromIntegral (length ret)) seqKafkaUnseqRead
    return ret

writeSeqVmEvents :: [OutputEvent] -> GregorM ()
writeSeqVmEvents events = do
    void $ K.withKafkaRetry1s (SK.writeSeqVmEvents events)
    P.unsafeAddCounter (fromIntegral(length events)) seqKafkaSeqWrites

writeSeqP2pEvents :: [OutputEvent] -> GregorM ()
writeSeqP2pEvents events = do
    void $ K.withKafkaRetry1s (SK.writeSeqP2pEvents events)
    P.unsafeAddCounter (fromIntegral(length events)) seqKafkaSeqWrites

assertTopicCreation :: GregorM ()
assertTopicCreation = void $ K.withKafkaViolently SK.assertTopicCreation

getNextIngestedOffset :: GregorM KP.Offset
getNextIngestedOffset = do
  group  <- getKafkaConsumerGroup
  ret <- K.withKafkaRetry1s (K.fetchSingleOffset group SK.unseqEventsTopicName 0) >>= \case
    Left KP.UnknownTopicOrPartition -> -- we've never committed an Offset
        setNextIngestedOffset 0 >> getNextIngestedOffset
    Left err -> error $ "Unexpected response when fetching offset for " ++ show SK.unseqEventsTopicName ++ ": " ++ show err
    Right (ofs, _) -> return ofs
  P.incCounter seqKafkaCheckpointReads
  return ret

setNextIngestedOffset :: KP.Offset -> GregorM ()
setNextIngestedOffset newOffset = do
    group  <- getKafkaConsumerGroup
    $logInfoS "setNextIngestedOffset" . T.pack $ "Setting checkpoint to " ++ show newOffset
    P.incCounter seqKafkaCheckpointWrites
    op <- K.withKafkaViolently $ K.commitSingleOffset group SK.unseqEventsTopicName 0 newOffset ""
    op & \case
        Left err ->
            error $ "Unexpected response when setting the offset to " ++ show newOffset ++ ": " ++ show err
        Right () -> return ()

runTheGregor :: GregorConfig -> IO ()
runTheGregor cfg = runGregorM cfg loop
 where
  loop :: GregorM ()
  loop = forever $ do
    unseqOrSeq <- race readUnseqEvents' (race readP2P readVM)
    case unseqOrSeq of
      Left inEvents -> do
        $logInfoS "sequencer" . T.pack $ "Fetched " ++ show (length inEvents) ++ " events)"
        ch <- use gregorUnseq
        atomically . forM_ inEvents $ writeTMChan ch . snd
        unless (null inEvents) $ do
          let ofs = maximum . map fst $ inEvents
          setNextIngestedOffset ofs
      Right (Left p2pEvents) -> writeSeqP2pEvents p2pEvents
      Right (Right vmEvents) -> writeSeqVmEvents vmEvents

readP2P :: GregorM [OutputEvent]
readP2P = (atomically . readCh) =<< use gregorSeqP2P

readVM :: GregorM [OutputEvent]
readVM = (atomically . readCh) =<< use gregorSeqVM

drainTMChan :: TMChan a -> STM [a]
drainTMChan ch = do
  mmx <- tryReadTMChan ch
  case mmx of
    Nothing -> return []
    Just Nothing -> return []
    Just (Just x) -> (x:) <$> drainTMChan ch

readCh :: TMChan OutputEvent -> STM [OutputEvent]
readCh ch = do
  -- Block until at least 1 element is available
  _ <- peekTMChan ch
  drainTMChan ch
