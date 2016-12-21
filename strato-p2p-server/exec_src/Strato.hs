{-# LANGUAGE OverloadedStrings, TemplateHaskell #-}

import Control.Exception
import Control.Monad.IO.Class
import Control.Monad.Logger
import Control.Concurrent
import HFlags
import System.Directory
import System.Exit
import System.Posix.Process

import Blockchain.IOptions ()
import Blockchain.Mining.Options ()
import Blockchain.Output
import Blockchain.Options ()
import Blockchain.Quarry.Flags ()
import Blockchain.ServOptions
import Blockchain.VMOptions ()

import Executable.EthereumDiscovery
import Executable.EthereumVM
import Executable.StratoAdit
import Executable.StratoIndex
import Executable.StratoP2PClient
import Executable.StratoP2PServer
import Executable.StratoQuary


run::FilePath->LoggingT IO ()->IO ()
run logPath f = forkIO (runNoFork logPath f) >> return ()

runNoFork::FilePath->LoggingT IO ()->IO ()
runNoFork name f = do
  let logPath = "logs/" ++ name
  result <- try $ runLoggingT f $ printToFile logPath
  case result of
   Left e -> do
     liftIO $ appendFile logPath $ show (e::SomeException)
     liftIO $ putStrLn $ "Error in " ++ name ++ "\n" ++ show (e::SomeException)
     exitImmediately $ ExitFailure (-1)
     return undefined
   Right _ -> return ()

main :: IO ()
main = do
  args <- $initHFlags "Strato Peer Server"

  createDirectoryIfMissing False "logs"

  if flags_runUDPServer 
    then do
      putStrLn "Starting UDP server"
      _ <- forkIO $ flip runLoggingT (printToFile "logs/etherum-discovery") ethereumDiscovery
      return ()
    else putStrLn "UDP server disabled"

  run "strato-quarry" stratoQuary
  run "strato-adit" stratoAdit
  run "etherum-vm" ethereumVM
  run "strato-index" stratoIndex
  run "strato-p2p-client" $ stratoP2PClient args
  runNoFork "strato-p2p-server" stratoP2PServer
