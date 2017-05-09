{-# LANGUAGE OverloadedStrings, FlexibleContexts, TypeFamilies, TemplateHaskell #-}

module Blockchain.SeqEventNotify (
  seqEventNotifictationSource
  ) where

import Conduit
import Control.Monad
import Control.Monad.Logger
import qualified Data.Text as T
import qualified Network.Kafka as K
import qualified Network.Kafka.Protocol as KP

import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka (readSeqEvents, seqEventsTopicName)

seqEventNotifictationSource :: ( MonadIO m
                               , MonadBaseControl IO m
                               , MonadResource m
                               , MonadLogger m
                               , K.HasKafkaState (ConduitM () OutputEvent m)
                               )
                            => Source m OutputEvent 
seqEventNotifictationSource = do
    ofs' <- K.withKafkaViolently $ K.getLastOffset K.LatestTime 0 seqEventsTopicName
    loop ofs'
    where loop nextOffset = do
              events <- K.withKafkaViolently $ readSeqEvents nextOffset 
              $logInfoS "seqEventNotify" . T.pack $ "read kafka seqevents @ " ++ show nextOffset
              forM_ events $ \e -> do
                  yield $ e
              loop . (nextOffset +) . KP.Offset . fromIntegral $ length events
