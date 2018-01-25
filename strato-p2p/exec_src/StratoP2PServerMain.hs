{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

import           Control.Concurrent
import           Control.Monad
import           Control.Monad.Logger
import           HFlags

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
  runLoggingT stratoP2PServer printLogMsg
