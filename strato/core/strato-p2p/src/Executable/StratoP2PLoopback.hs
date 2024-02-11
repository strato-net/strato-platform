{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Executable.StratoP2PLoopback (stratoP2PLoopback) where

import BlockApps.Logging
import Blockchain.Blockstanbul (WireMessage)
import Blockchain.Context
import Blockchain.Options
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.SeqEventNotify
--import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Keccak256
import Conduit
--import Control.Monad.Trans.Reader
import qualified Control.Monad.Change.Alter as A
--import Control.Monad.Change.Modify
--import Crypto.Types.PubKey.ECC
import qualified Data.Text as T
import Prometheus
import Text.Format
import Data.IORef
import Data.Set.Ordered (empty)

{-# NOINLINE loopbackEvents #-}
loopbackEvents :: Vector T.Text Counter
loopbackEvents =
  unsafeRegister
    . vector "direction"
    . counter
    $ Info "p2p_loopback_events" "Counts of events reflected back to the sequencer"

recordEvent :: MonadIO m => T.Text -> m ()
recordEvent lab = liftIO $ withLabel loopbackEvents lab incCounter

--stratoP2PLoopback :: MonadP2P n => PeerRunner n (LoggingT IO) () -> LoggingT IO ()
--stratoP2PLoopback runner = do
stratoP2PLoopback :: ( MonadLogger m
                     , MonadUnliftIO m
                     --, Accessible AvailablePeers (ReaderT Config (ResourceT (LoggingT m)))
                     --, Accessible BondedPeers (ReaderT Config (ResourceT (LoggingT m)))
                     --, A.Replaceable (IPAsText,Point) PeerBondingState (ReaderT Config (ResourceT (LoggingT m)))
                     --, A.Replaceable PPeer TcpEnableTime (ReaderT Config (ResourceT (LoggingT m)))
                     --, A.Replaceable PPeer UdpEnableTime (ReaderT Config (ResourceT (LoggingT m)))
                     --, A.Replaceable PPeer PeerDisable (ReaderT Config (ResourceT (LoggingT m)))
                     --, A.Replaceable PPeer T.Text (ReaderT Config (ResourceT (LoggingT m)))
                     --, A.Alters (IPAsText,TCPPort) ActivityState (ReaderT Config (ResourceT (LoggingT m)))
                     --, RunsServer (ReaderT Config (ResourceT (LoggingT m))) (LoggingT m)
                     )
                  => LoggingT m ()
stratoP2PLoopback = do
  wireMessagesRef <- liftIO $ newIORef empty
  cfg <- initConfig wireMessagesRef flags_maxReturnedHeaders
  let sSource  = seqEventNotificationSource $ contextKafkaState initContext
      runner f = runContextM cfg $ f sSource
  $logInfoS "stratoP2PLoopback" "Reflecting PBFT back to unseq since 2019"
  runner $ \sSource' -> do
    let toWireMessage = \case
          P2pBlockstanbul wm -> do
            let msgHash = rlpHash wm
            msgExists <- A.exists (A.Proxy @(A.Proxy (Inbound WireMessage))) msgHash
            if msgExists
              then do
                $logInfoS "stratoP2PLoopback/P2pBlockstanbul" . T.pack $ "Already seen inbound wire message " ++ format msgHash ++ ". Not forwarding to Sequencer."
                pure Nothing
              else do
                $logInfoS "stratoP2PLoopback/P2pBlockstanbul" . T.pack $ "First time seeing inbound wire message " ++ format msgHash ++ ". Forwarding to Sequencer."
                A.insert (A.Proxy @(A.Proxy (Inbound WireMessage))) msgHash A.Proxy
                pure $ Just wm
          _ -> pure Nothing

    runConduit $
      sSource'
        .| iterMC (const $ recordEvent "in")
        .| concatMapMC toWireMessage
        .| iterMC (const $ recordEvent "out")
        .| mapM_C emitBlockstanbulMsg
