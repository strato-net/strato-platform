{-# LANGUAGE TemplateHaskell #-}

import Blockchain.Init.Generator
-- Imported for its flags alone: initHFlags only sees the flags of the modules
-- this one imports.
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

  args <- $initHFlags "strato-setup [node-directory] [flags...]"
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
  mkFilesAndGenesis nodeDir hasFlags flags_network
