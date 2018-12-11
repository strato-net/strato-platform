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

import           Control.Concurrent.Async.Lifted (race_)
import           Control.Concurrent.STM (orElse, flushTQueue)
import           Control.Lens               hiding (op)
import           Control.Monad.State
import           Control.Monad.Logger
import           Control.Monad.Trans.Resource
import qualified Data.Text as T
import qualified Prometheus as P
import           UnliftIO.STM

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
                     , _gregorUnseq :: TQueue IngestEvent
                     , _gregorSeqP2P :: TQueue OutputEvent
                     , _gregorSeqVM :: TQueue OutputEvent
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

getKafkaConsumerGroup :: GregorM KP.ConsumerGroup
getKafkaConsumerGroup = use gregorConsumerGroup

readUnseqEvents' :: GregorM [(KP.Offset, IngestEvent)]
readUnseqEvents' = do
    offset <- getNextIngestedOffset
    $logInfoS "readUnseqEvents'" . T.pack $ "Fetching unseqevents from " ++ show offset
    -- its really [(nextOffset, eventAtThisOffset)]
    ret <- zip [(offset+1)..] <$> K.withKafkaRetry1s (SK.readUnseqEvents offset)
    P.unsafeAddCounter gregorUnseqRead (fromIntegral (length ret))
    return ret

writeSeqVmEvents :: [OutputEvent] -> GregorM ()
writeSeqVmEvents events = do
    void $ K.withKafkaRetry1s (SK.writeSeqVmEvents events)
    P.unsafeAddCounter gregorVMWrite (fromIntegral(length events))

writeSeqP2pEvents :: [OutputEvent] -> GregorM ()
writeSeqP2pEvents events = do
    void $ K.withKafkaRetry1s (SK.writeSeqP2pEvents events)
    P.unsafeAddCounter gregorP2PWrite (fromIntegral(length events))

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
  P.incCounter gregorKafkaCheckpointReads
  return ret

setNextIngestedOffset :: KP.Offset -> GregorM ()
setNextIngestedOffset newOffset = do
    group  <- getKafkaConsumerGroup
    $logInfoS "setNextIngestedOffset" . T.pack $ "Setting checkpoint to " ++ show newOffset
    P.incCounter gregorKafkaCheckpointWrites
    P.setGauge gregorUnseqOffset (fromIntegral newOffset)
    op <- K.withKafkaViolently $ K.commitSingleOffset group SK.unseqEventsTopicName 0 newOffset ""
    op & \case
        Left err ->
            error $ "Unexpected response when setting the offset to " ++ show newOffset ++ ": " ++ show err
        Right () -> return ()

runTheGregor :: GregorConfig -> IO ()
runTheGregor cfg = race_ (runGregorM cfg unseqReader)
                         (runGregorM cfg seqWriters)

unseqReader :: GregorM ()
unseqReader = forever . timeAction gregorUnseqTiming $ do
  inEvents <- readUnseqEvents'
  P.withLabel gregorLoop "unseq_events" P.incCounter
  $logInfoS "gregor" . T.pack $ "Fetched " ++ show (length inEvents) ++ " unseq events"
  ch <- use gregorUnseq
  atomically . forM_ inEvents $ writeTQueue ch . snd
  hd <- atomically $ tryPeekTQueue ch
  $logDebugS "gregor/unseqchHead" . T.pack . show $ hd
  P.unsafeAddCounter gregorUnseqWrite (fromIntegral (length inEvents))
  unless (null inEvents) $ do
    let ofs = maximum . map fst $ inEvents
    setNextIngestedOffset ofs

seqWriters :: GregorM ()
seqWriters = forever . timeAction gregorSeqTiming $ do
  vmq <- use gregorSeqVM
  p2pq <- use gregorSeqP2P
  events <- atomically $
    fmap Left (blockFlushTQueue vmq) `orElse` fmap Right (blockFlushTQueue p2pq)
  $logDebugS "gregor/seqWriter" . T.pack . show $ events
  case events of
    Left vmevs -> do
      P.withLabel gregorLoop "seq_vm_events" P.incCounter
      P.unsafeAddCounter gregorVMRead (fromIntegral $ length vmevs)
      writeSeqVmEvents vmevs
    Right p2pevs -> do
      P.withLabel gregorLoop "seq_p2p_events" P.incCounter
      P.unsafeAddCounter gregorP2PRead (fromIntegral $ length p2pevs)
      writeSeqP2pEvents p2pevs

-- Will only read if at least one element is in the channel.
blockFlushTQueue :: TQueue a -> STM [a]
blockFlushTQueue ch = do
  first <- readTQueue ch
  rest <- flushTQueue ch
  return $! first:rest
