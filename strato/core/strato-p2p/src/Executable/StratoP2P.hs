{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Executable.StratoP2P where

import           Control.Concurrent.Async.Lifted.Safe
import           Control.Exception hiding (catch)
import           Control.Exception.Lifted (catch)
import qualified Data.Text as T
import           BlockApps.Logging
import           Blockchain.Context
import           Executable.StratoP2PClient
-- import           Executable.StratoP2PClientDirect
import           Executable.StratoP2PServer
import           Executable.StratoP2PLoopback

stratoP2P :: ( MonadP2P n
             , RunsClient n
             , RunsServer n (LoggingT IO)
             )
          => PeerRunner n (LoggingT IO) () -> LoggingT IO ()
stratoP2P runner =
  -- concurrently_ (
  race_ (stratoP2PLoopback runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PLoopback ERROR" . T.pack $ show e))
    (race_ (stratoP2PClient runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PClient ERROR" . T.pack $ show e))
           (stratoP2PServer runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PServer ERROR" . T.pack $ show e)))
  -- )(stratoP2PClientDirect runner)