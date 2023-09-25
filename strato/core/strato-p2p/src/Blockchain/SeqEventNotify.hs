{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RankNTypes            #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeFamilies          #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}

module Blockchain.SeqEventNotify (
--  seqEventNotificationSource,
  seqEventNotificationSourceChanFill,
  seqEventNotificationSourceChanPour
  ) where

import           Conduit
import           Control.Concurrent.Chan.Unagi
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
                                   => K.KafkaState -> InChan (P2pEvent,Int64) -> m ()
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
                            liftIO $ writeChan p2peventchan (e,(\(KP.Offset o) -> o) nextOffset)
                        loop . (nextOffset +) . KP.Offset . fromIntegral $ length events

seqEventNotificationSourceChanPour :: ( MonadIO m
                                      , MonadLogger m 
                                      )
                                   => t -> (t -> IO (OutChan (P2pEvent,Int64))) -> ConduitT () P2pEvent m ()
seqEventNotificationSourceChanPour p2peventchan dupaction = do
  dupchan <- liftIO $ dupaction p2peventchan
  loop dupchan
  where loop chan = do
            (event,nextOffset) <- liftIO $ readChan chan
            $logInfoS "seqEventNotifyChanPour" . T.pack $ "pouring from kafka middleman of kafka seqevents @ Offset " ++ show nextOffset
            _ <- yield event
            loop chan

{-
seqEventNotificationSource :: ( MonadIO m
                              , MonadLogger m
                              )
                           => K.KafkaState -> ConduitM () P2pEvent m ()
seqEventNotificationSource ks = evalStateC ks $ do
    ofs' <- lift $ K.withKafkaRetry1s $ K.getLastOffset K.LatestTime 0 seqP2pEventsTopicName
    loop ofs'
    where loop nextOffset = do
              events <- lift $ K.withKafkaRetry1s $ readSeqP2pEvents nextOffset
              unless (null events) $ do -- stop bloating the logs
                $logInfoS "seqEventNotify" . T.pack $ "reading at kafka seqevents @ " ++ show nextOffset
                forM_ events $ \e -> do
                    yield $ e
              loop . (nextOffset +) . KP.Offset . fromIntegral $ length events
-}
