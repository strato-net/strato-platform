{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
module Executable.StratoP2PLoopback (stratoP2PLoopback) where

import Conduit
import Control.Monad
import Control.Monad.Trans.State.Strict
import qualified Data.Text as T
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
  ctx <- initContext flags_maxReturnedHeaders
  void . runContextM ctx $ do
    ks <- gets contextKafkaState
    let toWireMessage = \case
          P2pBlockstanbul wm -> Just wm
          _ -> Nothing

    runConduit $
         seqEventNotificationSource ks
      .| iterMC (const $ recordEvent "in")
      .| concatMapC toWireMessage
      .| iterMC (const $ recordEvent "out")
      .| mapM_C emitBlockstanbulMsg
