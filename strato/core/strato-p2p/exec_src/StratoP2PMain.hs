{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE OverloadedStrings     #-}

import           Control.Monad.IO.Class
import           Control.Concurrent.Async.Lifted.Safe
import           Control.Exception (SomeException, try)
import           Blockchain.VMOptions       ()

import           HFlags

import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Prometheus

import           Blockchain.Context
import           Blockchain.EthConf
import           Blockchain.Options
import           Blockchain.Strato.Model.Options()
import           Blockchain.Participation (p2pApp, setParticipationMode)
import           Blockchain.SeqEventNotify
import           Blockchain.Strato.Discovery.Data.Peer (resetPeers)
import           Blockchain.Strato.Discovery.Data.PeerIOWiring ()
import           Blockchain.Threads
import           Control.Monad.Composable.Vault (runVaultM)
import           Executable.StratoP2P
import           BlockApps.Init
import           BlockApps.Logging as BL
import           Data.IORef
import           Data.Set.Ordered (empty)
import           Instrumentation
import           Blockchain.Sequencer.Kafka (seqP2pEventsTopicName, unseqEventsTopicName)
import           Control.Monad.Composable.Kafka (createTopicAndWait)

main :: IO ()
main = runLoggingT initP2P

initP2P :: LoggingT IO ()
initP2P = labelTheThread "initP2P" $ do
  liftIO $ blockappsInit "strato_p2p"
  liftIO $ runInstrumentation "strato-p2p"
  -- Reset peer active states on startup. We ignore errors here because on first startup,
  -- ethereum-discover is responsible for creating the p_peer table, and it may not have
  -- run its migrations yet. If the table doesn't exist, there's nothing to reset anyway -
  -- a freshly created table will already have all peers in the inactive state.
  _ <- liftIO $ (try resetPeers :: IO (Either SomeException ()))
  _ <- liftIO $ $initHFlags "Strato P2P"
  liftIO $ runKafkaMConfigured "strato-p2p" $ do
    createTopicAndWait seqP2pEventsTopicName
    createTopicAndWait unseqEventsTopicName
  setParticipationMode flags_participationMode
  wireMessagesRef <- liftIO $ newIORef empty
  cfg <- initConfig wireMessagesRef
  let vaultUrl' = vaultUrl . urlConfig $ ethConf
      sSource = seqEventNotificationSource . contextKafkaState
      runner f = runLoggingT $ runVaultM vaultUrl' $ do
        c' <- initContext
        ctx <- liftIO $ newIORef c'
        let cfg' = cfg { configContext = ctx }
        runContextM cfg' . f $ sSource c'
  liftIO $
    race_
      (run 10248 $ prometheus def p2pApp)
      (stratoP2P runner)
