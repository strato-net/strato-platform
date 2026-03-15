{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import BlockApps.Logging
import Blockchain.Init.Generator
import Blockchain.Init.Options ()
import Blockchain.Strato.Model.Options (flags_network)
import HFlags
import System.Environment (getArgs)
import System.IO (hPutStrLn, stderr)
import System.Exit (exitFailure)

main :: IO ()
main = do
  -- Count original args to detect if flags were provided
  origArgs <- getArgs
  let hasFlags = length origArgs > 1
  
  args <- $initHFlags "strato-setup <node-directory>"
  nodeDir <- case args of
    [dir] -> return dir
    [] -> do
      hPutStrLn stderr "Error: node directory required"
      hPutStrLn stderr "Usage: strato-setup <node-directory> [flags...]"
      exitFailure
    _ -> do
      hPutStrLn stderr "Error: too many positional arguments"
      hPutStrLn stderr "Usage: strato-setup <node-directory> [flags...]"
      exitFailure
  runLoggingT $ mkFilesAndGenesis nodeDir hasFlags flags_network
