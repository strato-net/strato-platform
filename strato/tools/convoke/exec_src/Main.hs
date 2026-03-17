{-# LANGUAGE OverloadedStrings #-}

module Main (
  main
  ) where

import System.Process
import System.IO
import System.Exit
import System.Directory
import System.Environment (getArgs, setEnv)
import System.Posix.Types (ProcessID)
import System.Posix.User (getEffectiveUserID, getEffectiveGroupID)
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
    Nothing -> hPutStrLn stderr "Warning: invalid PIDs in pid file"
    Just pids -> forM_ (filter (/= survivor) pids) $ \pid -> do
      result <- try $ signalProcess sigTERM pid :: IO (Either SomeException ())
      case result of
        Left e  -> hPutStrLn stderr $ "Failed to kill PID " ++ show pid ++ ": " ++ displayException e
        Right _ -> hPutStrLn stderr $ "Killed PID " ++ show pid

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
    hPutStrLn stderr $ unlines linesToPrint

-- Start docker compose containers
dockerComposeUp :: IO ()
dockerComposeUp = do
  uid <- show <$> getEffectiveUserID
  gid <- show <$> getEffectiveGroupID
  setEnv "DOCKER_UID" uid
  setEnv "DOCKER_GID" gid
  putStrLn "Starting Docker containers..."
  -- Redirect docker compose stderr to stdout (goes to log, not terminal)
  let cp = (proc "docker" ["compose", "-p", "strato", "up", "-d", "--wait"])
             { std_err = UseHandle stdout }
  (_, _, _, ph) <- createProcess cp
  ec <- waitForProcess ph
  case ec of
    ExitSuccess -> putStrLn "Docker containers started."
    ExitFailure code -> do
      hPutStrLn stderr $ "ERROR: docker compose up failed with exit code " ++ show code
      exitWith ec

-- Stop docker compose containers
dockerComposeDown :: IO ()
dockerComposeDown = do
  hPutStrLn stderr "Stopping Docker containers..."
  -- Redirect docker compose stderr to stdout (goes to log, not terminal)
  let cp = (proc "docker" ["compose", "-p", "strato", "down"])
             { std_err = UseHandle stdout }
  (_, _, _, ph) <- createProcess cp
  _ <- waitForProcess ph
  hPutStrLn stderr "Docker containers stopped."

main :: IO ()
main = do
  args <- getArgs
  let noDocker = "--no-docker" `elem` args

  -- Clear previous PID file
  writeFile pidFile ""

  exists <- doesFileExist commandsFile
  unless exists $ error "commands.txt not found"

  rawLines <- lines <$> readFile commandsFile
  let commandList = catMaybes $ map parseLine rawLines

  unless (not (null commandList)) $
    error "No valid commands found in commands.txt"

  -- Start docker compose first (unless --no-docker)
  unless noDocker dockerComposeUp

  putStrLn $ "Launching " ++ show (length commandList) ++ " processes..."
  asyncs <- sequence $ map launchCommand commandList

  result <- waitAnyOrInterrupt asyncs
  case result of
    Just (_, (exitCode, pid, cmd)) -> do
      hPutStrLn stderr $ "ERROR: Process " ++ cmd ++ " (PID " ++ show pid ++ ") exited with: " ++ show exitCode
      killRemainingExcept pid
      hPutStrLn stderr "Tail of logs for crashed process:"
      tailFile 20 (logsDir </> cmd)
    Nothing -> do
      hPutStrLn stderr "Interrupted by Ctrl-C"
      killAllProcesses

  -- Stop docker compose on shutdown (unless --no-docker)
  unless noDocker dockerComposeDown

  removeFile pidFile `catch` \e ->
    hPutStrLn stderr $ "Warning: could not delete pid file: " ++ show (e :: IOError)
  hPutStrLn stderr "Shutdown complete."
