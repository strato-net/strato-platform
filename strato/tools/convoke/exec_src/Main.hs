{-# LANGUAGE OverloadedStrings #-}

-- {-# OPTIONS -fno-warn-unused-imports #-}
-- {-# OPTIONS -fno-warn-unused-matches #-}
-- {-# OPTIONS -fno-warn-missing-export-lists #-}

module Main (
  main
  ) where

import System.Process
import System.IO
import System.Exit
import System.Directory
import System.Posix.Types (ProcessID)
import System.Posix.Signals (signalProcess, sigTERM)
import Control.Concurrent.Async
import Control.Exception
import Control.Monad
import Text.Read (readMaybe)
import Data.Maybe (catMaybes)
import qualified ShellWords as Sh
import System.FilePath ((</>))
import WaitAnyOrInterrupt

-- File locations
commandsFile :: FilePath
commandsFile = "commands.txt"

pidFile :: FilePath
pidFile = "pids.txt"

logsDir :: FilePath
logsDir = "logs"

-- Parse a shell-style command line into (cmd, args)
parseLine :: String -> Maybe (FilePath, [String])
parseLine line =
  case Sh.parse line of
    Left _ -> Nothing
    Right [] -> Nothing
    Right (cmd:args) -> Just (cmd, args)

-- Launch a command and track its PID
launchCommand :: (FilePath, [String]) -> IO (Async (ExitCode, ProcessID, FilePath))
launchCommand (cmd, args) = do
  let logFile = logsDir </> cmd
  createDirectoryIfMissing True logsDir
  h <- openFile logFile WriteMode

  let cp = (proc cmd args)
        { std_out = UseHandle h
        , std_err = UseHandle h
        , create_group = True
        }

  (_, _, _, ph) <- createProcess cp
  mpid <- getPid ph
  case mpid of
    Nothing -> do
      hClose h
      error $ "Could not get PID for: " ++ cmd
    Just pid -> do
      appendFile pidFile (show pid ++ "\n")
      putStrLn $ "Started: " ++ cmd ++ " (PID " ++ show pid ++ ")"
      async $ do
        ec <- waitForProcess ph
        hClose h
        return (ec, pid, cmd)




-- Kill all PIDs in pid file, except optionally one survivor
killRemainingExcept :: ProcessID -> IO ()
killRemainingExcept survivor = do
  exists <- doesFileExist pidFile
  unless exists $ return ()
  contents <- readFile pidFile
  let maybePids = mapM readMaybe (lines contents) :: Maybe [ProcessID]
  case maybePids of
    Nothing -> putStrLn "Warning: invalid PIDs in pid file"
    Just pids -> forM_ (filter (/= survivor) pids) $ \pid -> do
      result <- try $ signalProcess sigTERM pid :: IO (Either SomeException ())
      case result of
        Left e  -> putStrLn $ "Failed to kill PID " ++ show pid ++ ": " ++ displayException e
        Right _ -> putStrLn $ "Killed PID " ++ show pid

-- Kill all PIDs unconditionally
killAllProcesses :: IO ()
killAllProcesses = killRemainingExcept (-1)

-- Get the last n elements from a list
tailN :: Int -> [a] -> [a]
tailN n xs = drop (length xs - n) xs

tailFile :: Int -> FilePath -> IO ()
tailFile n path = do
    contents <- readFile path
    let linesToPrint = tailN n (lines contents)
    putStrLn $ unlines linesToPrint

main :: IO ()
main = do
  -- Clear previous PID file
  writeFile pidFile ""

  exists <- doesFileExist commandsFile
  unless exists $ error "commands.txt not found"

  rawLines <- lines <$> readFile commandsFile
  let commandList = catMaybes $ map parseLine rawLines

  unless (not (null commandList)) $
    error "No valid commands found in commands.txt"

  putStrLn $ "Launching " ++ show (length commandList) ++ " processes..."
  asyncs <- sequence $ map launchCommand commandList

  result <- waitAnyOrInterrupt asyncs
  case result of
    Just (_, (exitCode, pid, cmd)) -> do
      putStrLn $ "Process " ++ cmd ++ " (" ++ show pid ++ ") exited with: " ++ show exitCode
      killRemainingExcept pid
      putStrLn "Tail of logs for crashed process:"
      tailFile 20 (logsDir </> cmd)
    Nothing -> do
      putStrLn "Interrupted by Ctrl-C"
      killAllProcesses

  removeFile pidFile `catch` \e ->
    putStrLn $ "Warning: could not delete pid file: " ++ show (e :: IOError)
  putStrLn "Shutdown complete."
