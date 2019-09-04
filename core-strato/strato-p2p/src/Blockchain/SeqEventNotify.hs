{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeFamilies          #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}

module Blockchain.SeqEventNotify (
  seqEventNotificationSource
  ) where

import           Conduit
import           Control.Monad.Change.Modify (Modifiable(..))
import           Control.Monad
import qualified Control.Monad.Trans.State.Strict as State
import           Blockchain.Output
import qualified Data.Text                   as T
import qualified Network.Kafka               as K
import qualified Blockchain.MilenaTools      as K
import qualified Network.Kafka.Protocol      as KP

import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka (readSeqP2pEvents, seqP2pEventsTopicName)

instance Monad m => Modifiable K.KafkaState (State.StateT K.KafkaState m) where
  get _ = State.get
  put _ = State.put

seqEventNotificationSource :: ( MonadIO m
                              , MonadResource m
                              , MonadLogger m
                              )
                           => K.KafkaState -> ConduitM () OutputEvent m ()
seqEventNotificationSource ks = evalStateC ks $ do
    ofs' <- lift $ K.withKafkaViolently $ K.getLastOffset K.LatestTime 0 seqP2pEventsTopicName
    loop ofs'
    where loop nextOffset = do
              events <- lift $ K.withKafkaViolently $ readSeqP2pEvents nextOffset
              unless (null events) $ do -- stop bloating the logs
                $logInfoS "seqEventNotify" . T.pack $ "read kafka seqevents @ " ++ show nextOffset
                forM_ events $ \e -> do
                    yield $ e
              loop . (nextOffset +) . KP.Offset . fromIntegral $ length events
