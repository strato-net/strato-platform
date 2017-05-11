{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

import           Control.Concurrent
import           Control.Monad.Logger
import           HFlags

import           Blockchain.Output
import           Blockchain.ServOptions
import           Executable.EthereumDiscovery
import           Executable.StratoP2PServer

main :: IO ()
main = do
  s <- $initHFlags "Strato Peer Server"
  putStrLn $ "strato-p2p-server with flags: " ++ unlines s
  if flags_runUDPServer
    then do
      putStrLn "Starting UDP server"
      _ <- forkIO $ runLoggingT ethereumDiscovery (printLogMsg' True True)
      return ()
    else putStrLn "UDP server disabled"

  runLoggingT stratoP2PServer (printLogMsg' True True)
