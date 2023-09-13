{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RankNTypes            #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeFamilies          #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}

module Blockchain.SeqEventNotify (
  seqEventNotificationSource,
  seqEventNotificationSourceTQueueFill
  ) where

import           Conduit
import           Control.Concurrent.STM.TQueue
import           Control.Monad.Change.Modify (Modifiable(..))
import           Control.Monad
import           Control.Monad.Except
import           Control.Monad.STM
import qualified Control.Monad.Trans.State.Strict as State
import qualified Data.Text                   as T

import qualified Network.Kafka               as K
import qualified Blockchain.MilenaTools      as K
import qualified Network.Kafka.Protocol      as KP
import           BlockApps.Logging           as BL
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka (readSeqP2pEvents, seqP2pEventsTopicName)

instance Monad m => Modifiable K.KafkaState (State.StateT K.KafkaState m) where
  get _ = State.get
  put _ = State.put

{-
seqEventNotificationSourceTQueueFill :: ( K.Kafka (m IO),
                                          --MonadState K.KafkaState (m IO),
                                          --MonadError K.KafkaClientError (m IO), 
                                          --MonadIO (m IO),
                                          --MonadBaseControl IO (m IO),
                                          MonadTrans m
                                        )
                                     => TQueue P2pEvent -> m IO ()
seqEventNotificationSourceTQueueFill p2peventtqueue = do
  ofs' <- K.getLastOffset K.LatestTime 0 seqP2pEventsTopicName
  loop ofs'
    where loop nextOffset = do
            events <- readSeqP2pEvents nextOffset
            unless (null events) $ do -- stop bloating the logs
              forM_ events $ \e -> do
                lift $ atomically $ writeTQueue p2peventtqueue e
            loop . (nextOffset +) . KP.Offset . fromIntegral $ length events
-}

--seqEventNotificationSourceTQueueFill :: ( Modifiable K.KafkaState IO
--                                        , Monad m
--                                        , MonadLogger IO
--                                        ) => State.StateT (IO ()) (ExceptT e m) a -> TQueue P2pEvent -> m (Either e a)

seqEventNotificationSourceTQueueFill :: ( Modifiable K.KafkaState IO
                                        , Monad m
                                        , MonadLogger IO
                                        , Show a
                                        )
                                     => State.StateT (IO ()) (ExceptT e (Either a)) a -> TQueue P2pEvent -> m ()
seqEventNotificationSourceTQueueFill ks p2peventtqueue = do
  let res = runExceptT $ State.evalStateT ks $ do
              ofs' <- K.withKafkaRetry1s $ K.getLastOffset K.LatestTime 0 seqP2pEventsTopicName
              loop ofs'
              where loop nextOffset = do
                        events <- K.withKafkaRetry1s $ readSeqP2pEvents nextOffset
                        unless (null events) $ do -- stop bloating the logs
                          $logInfoS "seqEventNotifyTQueueFill" . T.pack $ "filling tqueue from kafka seqevents @ " ++ show nextOffset
                          forM_ events $ \e -> do
                            atomically $ writeTQueue p2peventtqueue e
                          loop . (nextOffset +) . KP.Offset . fromIntegral $ length events
  case res of
    Left  e -> error $ show e
    Right _ -> return ()

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
                $logInfoS "seqEventNotifyTQueuePour" . T.pack $ "pouring from tqueue at kafka seqevents @ " ++ show nextOffset
                forM_ events $ \e -> do
                    yield $ e
              loop . (nextOffset +) . KP.Offset . fromIntegral $ length events
