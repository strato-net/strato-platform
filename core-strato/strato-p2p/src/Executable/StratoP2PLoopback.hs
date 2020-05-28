{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
module Executable.StratoP2PLoopback (stratoP2PLoopback) where

import Conduit
import Control.Monad
import qualified Control.Monad.Change.Modify           as Mod
import qualified Data.Text as T
import qualified Network.Kafka                         as K
import Prometheus

import BlockApps.Logging
import Blockchain.Context
import Blockchain.Options
import Blockchain.SeqEventNotify
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka

{-# NOINLINE loopbackEvents #-}
loopbackEvents :: Vector T.Text Counter
loopbackEvents = unsafeRegister
               . vector "direction"
               . counter
               $ Info "p2p_loopback_events" "Counts of events reflected back to the sequencer"

recordEvent :: MonadIO m => T.Text -> m ()
recordEvent lab = liftIO $ withLabel loopbackEvents lab incCounter

stratoP2PLoopback :: LoggingT IO ()
stratoP2PLoopback = do
  $logInfoS "stratoP2PLoopback" "Reflecting PBFT back to unseq since 2019"
  cfg <- initConfig flags_maxReturnedHeaders
  void . runContextM cfg $ do
    ks <- Mod.get (Mod.Proxy @K.KafkaState)
    let toWireMessage = \case
          P2pBlockstanbul wm -> Just wm
          _ -> Nothing

    runConduit $
         seqEventNotificationSource ks
      .| iterMC (const $ recordEvent "in")
      .| concatMapC toWireMessage
      .| iterMC (const $ recordEvent "out")
      .| mapM_C emitBlockstanbulMsg
