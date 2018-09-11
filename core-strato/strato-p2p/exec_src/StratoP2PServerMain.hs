{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

import           Control.Concurrent
import           Control.Concurrent.Async
import           Control.Monad
import           Control.Monad.Logger
import           HFlags
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Prometheus

import           Blockchain.Output
import           Blockchain.ServOptions
import           Executable.EthereumDiscovery
import           Executable.StratoP2PServer

main :: IO ()
main = do
  _ <- $initHFlags "Strato Peer Server"
  if flags_runUDPServer
    then void . forkIO $ runLoggingT ethereumDiscovery printLogMsg
    else return ()
  race_
    (run 10249 metricsApp)
    (runLoggingT stratoP2PServer printLogMsg)
