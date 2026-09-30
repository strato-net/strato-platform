{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE OverloadedStrings     #-}

import           Control.Monad.IO.Class
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
import           Control.Monad.Composable.Base (Eff, Logger, runEff)
import           Control.Monad.Composable.Vault (runVaultM)
import           Executable.StratoP2P
import           BlockApps.Init
import           BlockApps.Logging as BL
import           Data.IORef
import           Data.String (fromString)
import           Data.Set.Ordered (empty)
import           Instrumentation
import           Blockchain.Sequencer.Kafka (seqP2pEventsTopicName, unseqEventsTopicName)
import           Control.Monad.Composable.Streaming (createStreamEnv, createTopicAndWait)
import           Control.Concurrent.MVar (newMVar)

main :: IO ()
main = runEff $ runLogging initP2P

initP2P :: Eff '[Logger] ()
initP2P = labelTheThread "initP2P" $ do
  liftIO $ blockappsInit "strato_p2p"
  liftIO $ runInstrumentation "strato-p2p"
  -- Reset peer active states on startup. We ignore errors here because on first startup,
  -- ethereum-discover is responsible for creating the p_peer table, and it may not have
  -- run its migrations yet. If the table doesn't exist, there's nothing to reset anyway -
  -- a freshly created table will already have all peers in the inactive state.
  _ <- liftIO $ (try resetPeers :: IO (Either SomeException ()))
  _ <- liftIO $ $initHFlags "Strato P2P"
  runStreamMConfigured "strato-p2p" $ do
    createTopicAndWait seqP2pEventsTopicName
    createTopicAndWait unseqEventsTopicName
  setParticipationMode flags_participationMode
  wireMessagesRef <- liftIO $ newIORef empty
  cfg <- initConfig wireMessagesRef
  bcast <- newSeqEventBroadcast
  let vaultUrl' = vaultUrl . urlConfig $ ethConf
      streamAddr = let k = streamingConfig ethConf in (streamingHost k, streamingPort k)
      runner f = runEff . runLogging $ runVaultM vaultUrl' $ do
        c' <- initContext
        ctx <- liftIO $ newIORef c'
        -- Every peer connection gets its own producer. A single process-wide
        -- StreamEnv behind one MVar serialized every ToUnseq produce
        -- (blockstanbul gossip, txs and blocks) across all peers, so the whole
        -- p2p -> sequencer path ran one produce at a time node-wide (~68ms
        -- each) and BlockBodies starved behind the gossip firehose during
        -- sync. The MVar stays, to keep milena's non-atomic KafkaState
        -- read-modify-write safe within a single connection.
        env <- createStreamEnv "strato-p2p" streamAddr
        envVar <- liftIO $ newMVar env
        let cfg' = cfg { configContext = ctx, configStreamEnv = envVar }
        -- Sequencer events are consumed once per process by
        -- runSeqEventBroadcaster below and fanned out in memory. Each
        -- connection subscribes here, at its start, and sees the events
        -- published from then on, like the Kafka-era latest-offset source.
        -- Running one topic consumer per connection is not an option on the
        -- JLog backend, where all consumers with the same client id share a
        -- single checkpoint and would each get only a slice of the events.
        seqSrc <- subscribeSeqEvents bcast
        runContextM cfg' . f $ seqSrc
  liftIO $
    raceAll
      [ runSettings (setHost (fromString $ apiListenAddress $ apiConfig ethConf) $ setPort 10248 defaultSettings) $ prometheus def p2pApp
      , runSeqEventBroadcaster bcast
      , stratoP2P runner
      ]
