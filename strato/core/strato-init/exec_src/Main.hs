{-# LANGUAGE TemplateHaskell #-}

import Blockchain.Init.DockerComposeAllDocker (generateDockerComposeAllDocker)
import Blockchain.Init.Generator
import Blockchain.Init.Options (flags_composeOnly, flags_includeBuild)
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
  if flags_composeOnly
    then generateDockerComposeAllDocker True flags_includeBuild
    else do
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
