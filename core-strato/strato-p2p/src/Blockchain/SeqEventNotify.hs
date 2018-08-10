{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeFamilies      #-}

module Blockchain.SeqEventNotify (
  seqEventNotificationSource
  ) where

import           Conduit
import           Control.Monad
import           Control.Monad.Logger
import qualified Data.Text                  as T
import qualified Network.Kafka              as K
import qualified Blockchain.MilenaTools     as K
import qualified Network.Kafka.Protocol     as KP

import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka (readSeqP2pEvents, seqP2pEventsTopicName)

seqEventNotificationSource :: ( MonadIO m
                              , MonadBaseControl IO m
                              , MonadResource m
                              , MonadLogger m
                              , K.HasKafkaState m
                              )
                           => Source m OutputEvent
seqEventNotificationSource = do
    eOfs' <- lift $ K.withKafkaViolently $ K.getLastOffset K.LatestTime 0 seqP2pEventsTopicName
    let ofs' = either (const 0) id eOfs'
    loop ofs'
    where loop nextOffset = do
              eEvents <- lift $ K.withKafkaViolently $ readSeqP2pEvents nextOffset
              let events = either (const []) id eEvents
              unless (null events) $ do -- stop bloating the logs
                $logInfoS "seqEventNotify" . T.pack $ "read kafka seqevents @ " ++ show nextOffset
                forM_ events $ \e -> do
                    yield $ e
              loop . (nextOffset +) . KP.Offset . fromIntegral $ length events
