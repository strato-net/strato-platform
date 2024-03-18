{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Executable.StratoP2P where

import           Control.Concurrent.Async.Lifted.Safe(Concurrently(..),runConcurrently)
import           Control.Exception hiding (catch)
import           Control.Exception.Lifted (catch)
import           Data.Foldable            (asum)
import qualified Data.Text as T
import           BlockApps.Logging as BL
import           Blockchain.Context
import           Blockchain.Threads
import           Executable.StratoP2PClient
import           Executable.StratoP2PLoopback
import           Executable.StratoP2PServer

raceAll :: [LoggingT IO a]
        -> LoggingT IO a
raceAll = runConcurrently . asum . Prelude.map Concurrently

stratoP2P :: ( MonadP2P n
             , RunsClient n
             , RunsServer n (BL.LoggingT IO)
             )
          => PeerRunner n (BL.LoggingT IO) () -> BL.LoggingT IO ()
stratoP2P runner = labelTheThread "stratoP2P" $ do
  raceAll [ stratoP2PLoopback runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PLoopback ERROR" . T.pack $ show e)
          , stratoP2PClient   runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PClient ERROR" . T.pack $ show e)
          , stratoP2PServer   runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PServer ERROR" . T.pack $ show e)
          ]
