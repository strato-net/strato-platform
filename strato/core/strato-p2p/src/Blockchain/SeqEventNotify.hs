{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RankNTypes            #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeFamilies          #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}

module Blockchain.SeqEventNotify (
  seqEventNotificationSourceChanFill,
  seqEventNotificationSourceChanPour
  ) where

import           BroadcastChan
import           Conduit
import           Control.Monad.Change.Modify (Modifiable(..))
import           Control.Monad
import           Control.Monad.Except
import qualified Control.Monad.Trans.State.Strict as State
import           Data.Int (Int64)
import qualified Data.Text                        as T
import qualified Network.Kafka                    as K
import qualified Blockchain.MilenaTools           as K
import qualified Network.Kafka.Protocol           as KP
import           BlockApps.Logging                as BL
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka (readSeqP2pEvents, seqP2pEventsTopicName)

instance Monad m => Modifiable K.KafkaState (State.StateT K.KafkaState m) where
  get _ = State.get
  put _ = State.put

seqEventNotificationSourceChanFill :: ( MonadIO m
                                      , MonadLogger m
                                      )
                                   => K.KafkaState -> BroadcastChan In (P2pEvent,Int64) -> m ()
seqEventNotificationSourceChanFill ks p2peventchan = do
  res <- runExceptT $ flip State.evalStateT ks $ do
              ofs' <- K.withKafkaRetry1s $ K.getLastOffset K.LatestTime 0 seqP2pEventsTopicName
              loop ofs'
  case res of
    Left  e -> error $ show (e :: K.KafkaClientError)
    Right _ -> return ()
    where loop nextOffset = do
                        events <- K.withKafkaRetry1s $ readSeqP2pEvents nextOffset
                        unless (null events) $ do -- stop bloating the logs
                          $logInfoS "seqEventNotifyChanFill" . T.pack $ "filling kakfa middleman of kafka seqevents @ " ++ show nextOffset
                          forM_ events $ \e -> do
                            liftIO $ writeBChan p2peventchan (e,(\(KP.Offset o) -> o) nextOffset)
                        loop . (nextOffset +) . KP.Offset . fromIntegral $ length events

seqEventNotificationSourceChanPour :: ( MonadIO m
                                      , MonadLogger m
                                      )
                                   => BroadcastChan In (P2pEvent,Int64) -> ConduitT () P2pEvent m ()
seqEventNotificationSourceChanPour p2peventchanin = do
  dupchan <- liftIO $ newBChanListener p2peventchanin
  loop dupchan
  where loop chan = do
            newevent <- liftIO $ readBChan chan
            case newevent of
              Nothing                 -> loop chan
              Just (event,nextOffset) -> do $logInfoS "seqEventNotifyChanPour" . T.pack $ "pouring from kafka middleman of kafka seqevents @ Offset " ++ show nextOffset
                                            _ <- yield event
                                            loop chan