{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}

module Executable.StratoP2PKafkaTQueue (stratoP2PKafkaTQueue) where


import Control.Concurrent.STM.TQueue
import Control.Monad.Change.Modify (Modifiable(..))
import Control.Monad
import Control.Monad.Logger as L
--import UnliftIO.STM

--import BlockApps.Logging as BL
import Blockchain.Context
import Blockchain.Sequencer.Event
import Blockchain.SeqEventNotify
import Network.Kafka


stratoP2PKafkaTQueue :: ( Modifiable KafkaState IO
                        , MonadLogger IO
                        )
--                     => BL.LoggingT IO (Either KafkaClientError KafkaState)
                     => TQueue P2pEvent -> IO ()
stratoP2PKafkaTQueue kafkatqueue = do 
  --kafkatqueue    <- atomically newTQueue 
  initContextF <- initContext
  let kafkastate = contextKafkaState initContextF
  forever $ seqEventNotificationSourceTQueueFill (return kafkastate) kafkatqueue
  --forever $ (seqEventNotificationSourceTQueueFill (return kafkastate) kafkatqueue) :: BL.LoggingT IO (Either KafkaClientError KafkaState)
