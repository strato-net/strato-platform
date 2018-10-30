{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.SeqEventNotify
  ( seqEventNotificationSource
  , sourcePriorityQueue -- For testing
  ) where

import           Conduit
import           Control.Concurrent.Lifted hiding (yield)
import           Control.Monad
import           Control.Monad.Logger
import           Control.Monad.Reader.Class
import           Control.Monad.STM (orElse)
import           Control.Monad.Trans.Reader (runReaderT, ReaderT)
import           Data.Conduit.TQueue
import           Data.List                  (partition)
import qualified Data.Text                  as T
import           Text.Printf
import           UnliftIO.IORef
import           UnliftIO.STM

import qualified Blockchain.MilenaTools     as K
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka (readSeqP2pEvents, seqP2pEventsTopicName)
import qualified Network.Kafka              as K
import qualified Network.Kafka.Protocol     as KP

instance (MonadIO m) => K.HasKafkaState (ReaderT (IORef K.KafkaState) m) where
    getKafkaState = ask >>= readIORef
    putKafkaState k = ask >>= flip writeIORef k

seqEventNotificationSource :: ( MonadIO m
                              , MonadResource m
                              , MonadLogger m
                              , K.HasKafkaState m
                              , MonadBaseControl IO m
                              )
                           => ConduitM () OutputEvent m ()
seqEventNotificationSource = do
  (h, l) <- lift $ do
    kRef <- newIORef =<< K.getKafkaState
    hiPriQ <- atomically newTQueue
    loPriQ <- atomically newTQueue
    void . fork $ seqP2PReader kRef hiPriQ loPriQ
    return (hiPriQ, loPriQ)
  sourcePriorityQueue h l

isLowPriority :: OutputEvent -> Bool
isLowPriority OETx{} = True
isLowPriority _ = False

seqP2PReader :: (MonadBaseControl IO m, MonadIO m, MonadLogger m)
             => IORef K.KafkaState -> TQueue OutputEvent -> TQueue OutputEvent -> m ()
seqP2PReader s hipri lopri = flip runReaderT s $ do
  ofs' <- K.withKafkaViolently $ K.getLastOffset K.LatestTime 0 seqP2pEventsTopicName
  loop ofs'
 where loop nextOffset = do
         events <- K.withKafkaViolently $ readSeqP2pEvents nextOffset
         let (lows, highs) = partition isLowPriority events
         unless (null lows) $ do
           $logInfoS "seqEventNotify" . T.pack $
             printf "read %d low priority kafka events @%s" (length lows) (show nextOffset)
           atomically . forM_ lows $ writeTQueue lopri
         unless (null highs) $ do
           $logInfoS "seqEventNotify" . T.pack $
             printf "read %d high priority kafka events @%s" (length highs) (show nextOffset)
           atomically . forM_ highs $ writeTQueue hipri
         loop . (nextOffset +) . KP.Offset . fromIntegral $ length events

sourcePriorityQueue :: (MonadIO m, MonadBaseControl IO m, Monad m)
                    => TQueue a -> TQueue a -> ConduitM () a m ()
sourcePriorityQueue highQ lowQ = forever $
    yield <=< atomically $ readTQueue highQ `orElse` readTQueue lowQ
