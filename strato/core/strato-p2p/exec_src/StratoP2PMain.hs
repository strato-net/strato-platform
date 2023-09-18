{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE OverloadedStrings     #-}

import           Control.Concurrent (threadDelay)
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Concurrent.Async.Lifted.Safe
import           Blockchain.VMOptions       ()

import           HFlags

import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Prometheus

import           Blockchain.Context
import           Blockchain.Options
import           Blockchain.Strato.Model.Options()
import           Blockchain.Participation (p2pApp, setParticipationMode)
import           Blockchain.SeqEventNotify
import           Blockchain.Strato.Discovery.Data.Peer (resetPeers)
import           Executable.StratoP2P
import           BlockApps.Init
import           BlockApps.Logging as BL
import           Data.IORef
import           Data.Set.Ordered (empty)

main :: IO ()
main = runLoggingT initP2P

initP2P :: LoggingT IO ()
initP2P = do
  liftIO $ blockappsInit "strato_p2p"
  liftIO $ resetPeers
  _ <- liftIO $ $initHFlags "Strato P2P"
  setParticipationMode flags_participationMode
  wireMessagesRef <- liftIO $ newIORef empty
  cfg <- initConfig wireMessagesRef flags_maxReturnedHeaders
  context <- liftIO $ readIORef $ configContext cfg
  let contextkafkastate = contextKafkaState context
  let contextkafkamiddleman = contextKafkaMiddleman context
  _ <- async (runContextM cfg $ (forever $ do _ <- seqEventNotificationSourceChanFill (return contextkafkastate) contextkafkamiddleman; liftIO $ threadDelay 50))
  let sSource = seqEventNotificationSourceChanPour contextkafkamiddleman
      runner f = runContextM cfg $ f sSource
  liftIO $ race_
    (run 10248 $ prometheus def p2pApp)
    (runLoggingT $ stratoP2P runner)
