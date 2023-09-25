{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Executable.StratoP2P where

import           Control.Concurrent.Async.Lifted.Safe(Concurrently(..),runConcurrently)
import           Control.Exception hiding (catch)
import           Control.Exception.Lifted (catch)
import           Control.Monad.Logger
import           Data.Foldable            (asum)
import qualified Data.Text as T
import           BlockApps.Logging as BL
import           Blockchain.Context
import           Executable.StratoP2PClient
-- import          Executable.StratoP2PClientDirect
import           Executable.StratoP2PLoopback
import           Executable.StratoP2PServer

raceAll :: [BL.LoggingT IO a]
        -> BL.LoggingT IO a
raceAll = runConcurrently . asum . map Concurrently

stratoP2P :: ( MonadP2P n
             , RunsClient n
             , RunsServer n (BL.LoggingT IO)
             )
          => PeerRunner n (BL.LoggingT IO) () -> BL.LoggingT IO ()
stratoP2P runner =
  raceAll [ stratoP2PLoopback runner    `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PLoopback ERROR" . T.pack $ show e)
          , stratoP2PClient runner      `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PClient ERROR" . T.pack $ show e)
          , stratoP2PServer runner      `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PServer ERROR" . T.pack $ show e)
          ]