{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
module Executable.StratoP2PLoopback (stratoP2PLoopback) where

import Conduit
import Control.Monad
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import Data.IORef
import qualified Data.Set.Ordered as S
import qualified Data.Text as T
import qualified Network.Kafka                         as K
import Prometheus
import Text.Format

import BlockApps.Logging
import Blockchain.Blockstanbul (WireMessage)
import Blockchain.Context
import Blockchain.Options
import Blockchain.SeqEventNotify
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.Strato.Model.Keccak256

{-# NOINLINE loopbackEvents #-}
loopbackEvents :: Vector T.Text Counter
loopbackEvents = unsafeRegister
               . vector "direction"
               . counter
               $ Info "p2p_loopback_events" "Counts of events reflected back to the sequencer"

recordEvent :: MonadIO m => T.Text -> m ()
recordEvent lab = liftIO $ withLabel loopbackEvents lab incCounter

stratoP2PLoopback :: IORef (S.OSet Keccak256) -> LoggingT IO ()
stratoP2PLoopback wireMessagesRef = do
  $logInfoS "stratoP2PLoopback" "Reflecting PBFT back to unseq since 2019"
  cfg <- initConfig wireMessagesRef flags_maxReturnedHeaders
  void . runContextM cfg $ do
    ks <- Mod.get (Mod.Proxy @K.KafkaState)
    let toWireMessage = \case
          P2pBlockstanbul wm -> do
            let msgHash = rlpHash wm
            msgExists <- A.exists (A.Proxy @(A.Proxy WireMessage)) msgHash
            if msgExists
              then do
                $logInfoS "handleEvents/Blockstanbul" . T.pack $ "Already seen wire message " ++ format msgHash ++ ". Not forwarding to Sequencer."
                pure Nothing
              else do
                $logInfoS "handleEvents/Blockstanbul" . T.pack $ "First time seeing wire message " ++ format msgHash ++ ". Forwarding to Sequencer."
                A.insert (A.Proxy @(A.Proxy WireMessage)) msgHash (A.Proxy @WireMessage)
                pure $ Just wm
          _ -> pure Nothing

    runConduit $
         seqEventNotificationSource ks
      .| iterMC (const $ recordEvent "in")
      .| concatMapMC toWireMessage
      .| iterMC (const $ recordEvent "out")
      .| mapM_C emitBlockstanbulMsg
