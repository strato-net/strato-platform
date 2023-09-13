{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Executable.StratoP2P where

import           Control.Concurrent.Async.Lifted.Safe()
import           Control.Concurrent.PooledIO.Independent
import           Control.Exception hiding (catch)
import           Control.Exception.Lifted (catch)
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
--import           Data.Foldable            (asum)
import qualified Data.Text as T
import           BlockApps.Logging as BL
import           Blockchain.Context
import           Executable.StratoP2PClient
-- import           Executable.StratoP2PClientDirect
import           Executable.StratoP2PServer
import           Executable.StratoP2PLoopback
import           Executable.StratoP2PKafkaTQueue

{-
raceAll :: [BL.LoggingT IO a]
        -> BL.LoggingT IO a
raceAll = runConcurrently . asum . map Concurrently
-}

{-
raceAll :: [IO a]
        -> BL.LoggingT IO ()
raceAll services = liftIO $ withPool 15 $ \pool ->
                     parallel_ pool services
-}

raceAll :: [IO ()]
        -> BL.LoggingT IO ()
raceAll services = liftIO $ runLimited 4 services

stratoP2P :: ( MonadP2P n
             , RunsClient n
             , RunsServer n (BL.LoggingT IO)
             )
          => PeerRunner n (BL.LoggingT IO) () -> BL.LoggingT IO ()
stratoP2P runner = do
  ask <- askRunInIO
  -- concurrently_ (
  --race_ (stratoP2PLoopback runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PLoopback ERROR" . T.pack $ show e))
  --  (race_ (stratoP2PClient runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PClient ERROR" . T.pack $ show e))
  --         (stratoP2PServer runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PServer ERROR" . T.pack $ show e)))
  raceAll [ ask $ stratoP2PLoopback runner    `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PLoopback ERROR" . T.pack $ show e)
          , ask $ stratoP2PClient runner      `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PClient ERROR" . T.pack $ show e)
          , ask $ stratoP2PServer runner      `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PServer ERROR" . T.pack $ show e)
          , ask $ stratoP2PKafkaTQueue        `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PKafkaTQueue ERROR" . T.pack $ show e)
          ]
  {-
  race_ (stratoP2PClient runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PClient ERROR" . T.pack $ show e))
        (stratoP2PServer runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PServer ERROR" . T.pack $ show e))
  -}
  -- )(stratoP2PClientDirect runner)
