{-# LANGUAGE FlexibleContexts #-}

module Executable.StratoP2P where

import           Control.Concurrent.Async.Lifted.Safe
import           BlockApps.Logging
import           Blockchain.Context
import           Executable.StratoP2PClient
import           Executable.StratoP2PServer
import           Executable.StratoP2PLoopback

stratoP2P :: ( MonadP2P n
             , RunsClient n
             , RunsServer n (LoggingT IO)
             )
          => PeerRunner n (LoggingT IO) () -> IO ()
stratoP2P runner = runLoggingT $
  race_ (stratoP2PLoopback runner)
    (race_ (stratoP2PClient runner)
           (stratoP2PServer runner))