{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds    #-}
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

raceAll :: [IO a]
        -> IO a
raceAll = runConcurrently . asum . Prelude.map Concurrently

stratoP2P :: ( MonadP2P m
             , RunsClient m
             , RunsServer m
             )
          => PeerRunner m () -> IO ()
stratoP2P runner = labelTheThread "stratoP2P" $ do
  raceAll [ stratoP2PLoopback runner `catch` oops "stratoP2PLoopback"
          , stratoP2PClient   runner `catch` oops "stratoP2PClient"
          , stratoP2PServer   runner `catch` oops "stratoP2PServer"
          ]
  where oops :: T.Text -> SomeException -> IO ()
        oops name (e :: SomeException) = runner $ \_ ->
          $logErrorS (name <> " ERROR") . T.pack $ show e
