{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

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
import Data.List (intercalate)
import Text.Read (readMaybe)
import Data.Maybe (catMaybes)
import Data.Time (ZonedTime, defaultTimeLocale, formatTime, getZonedTime)
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

data ProcessExit = ProcessExit
  { processExitCode :: ExitCode
  , processPid :: ProcessID
  , processCmd :: FilePath
  , processArgs :: [String]
  , processLogFile :: FilePath
  , processStartedAt :: ZonedTime
  , processFinishedAt :: ZonedTime
  }

formatTimestamp :: ZonedTime -> String
formatTimestamp = formatTime defaultTimeLocale "%Y-%m-%dT%H:%M:%S%z"

renderCommand :: FilePath -> [String] -> String
renderCommand cmd args = intercalate " " (map show (cmd : args))

describeExitCode :: ExitCode -> String
describeExitCode ExitSuccess = "exit code 0"
describeExitCode (ExitFailure code) = "exit code " ++ show code

logSupervisor :: String -> IO ()
logSupervisor msg = do
  now <- getZonedTime
  hPutStrLn stderr $ formatTimestamp now ++ " convoke: " ++ msg

appendProcessLog :: Handle -> String -> IO ()
appendProcessLog h msg = do
  now <- getZonedTime
  hPutStrLn h $ formatTimestamp now ++ " convoke: " ++ msg
  hFlush h

-- Parse a shell-style command line into (cmd, args)
parseLine :: String -> Maybe (FilePath, [String])
parseLine line =
  case Sh.parse line of
    Left _ -> Nothing
    Right [] -> Nothing
    Right (cmd:args) -> Just (cmd, args)

-- Launch a command and track its PID
launchCommand :: (FilePath, [String]) -> IO (Async ProcessExit)
launchCommand (cmd, args) = do
  let logFile = logsDir </> cmd
  createDirectoryIfMissing True logsDir
  h <- openFile logFile AppendMode
  hSetBuffering h LineBuffering
  startedAt <- getZonedTime

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
      appendProcessLog h $ "starting command=" ++ renderCommand cmd args ++ " pid=" ++ show pid
      appendFile pidFile (show pid ++ "\n")
      logSupervisor $ "Started command=" ++ renderCommand cmd args ++ " pid=" ++ show pid ++ " log=" ++ logFile
      async $ do
        ec <- waitForProcess ph
        finishedAt <- getZonedTime
        appendProcessLog h $ "process exited with " ++ describeExitCode ec
        hClose h
        return ProcessExit
          { processExitCode = ec
          , processPid = pid
          , processCmd = cmd
          , processArgs = args
          , processLogFile = logFile
          , processStartedAt = startedAt
          , processFinishedAt = finishedAt
          }




-- Kill all PIDs in pid file, except optionally one survivor
killRemainingExcept :: ProcessID -> IO ()
killRemainingExcept survivor = do
  exists <- doesFileExist pidFile
  unless exists $ return ()
  contents <- readFile pidFile
  let maybePids = mapM readMaybe (lines contents) :: Maybe [ProcessID]
  case maybePids of
    Nothing -> logSupervisor "Warning: invalid PIDs in pid file"
    Just pids -> forM_ (filter (/= survivor) pids) $ \pid -> do
      result <- try $ signalProcess sigTERM pid :: IO (Either SomeException ())
      case result of
        Left e  -> logSupervisor $ "Failed to kill PID " ++ show pid ++ ": " ++ displayException e
        Right _ -> logSupervisor $ "Killed PID " ++ show pid

-- Kill all PIDs unconditionally
killAllProcesses :: IO ()
killAllProcesses = killRemainingExcept (-1)

-- Get the last n elements from a list
tailN :: Int -> [a] -> [a]
tailN n xs = drop (length xs - n) xs

tailFile :: Int -> FilePath -> IO ()
tailFile n path =
  (do
      contents <- readFile path
      let linesToPrint = tailN n (lines contents)
      hPutStrLn stderr $ unlines linesToPrint
  ) `catch` \(e :: IOException) ->
        logSupervisor $ "Could not read log tail from " ++ path ++ ": " ++ displayException e

-- Start docker compose containers
dockerComposeUp :: IO ()
dockerComposeUp = do
  uid <- show <$> getEffectiveUserID
  gid <- show <$> getEffectiveGroupID
  setEnv "DOCKER_UID" uid
  setEnv "DOCKER_GID" gid
  logSupervisor "Starting Docker containers..."
  -- Redirect docker compose stderr to stdout (goes to log, not terminal)
  let cp = (proc "docker" ["compose", "-p", "strato", "up", "-d", "--wait"])
             { std_err = UseHandle stdout }
  (_, _, _, ph) <- createProcess cp
  ec <- waitForProcess ph
  case ec of
    ExitSuccess -> logSupervisor "Docker containers started."
    ExitFailure code -> do
      logSupervisor $ "ERROR: docker compose up failed with exit code " ++ show code
      exitWith ec

-- Stop docker compose containers
dockerComposeDown :: IO ()
dockerComposeDown = do
  logSupervisor "Stopping Docker containers..."
  -- Redirect docker compose stderr to stdout (goes to log, not terminal)
  let cp = (proc "docker" ["compose", "-p", "strato", "down"])
             { std_err = UseHandle stdout }
  (_, _, _, ph) <- createProcess cp
  _ <- waitForProcess ph
  logSupervisor "Docker containers stopped."

main :: IO ()
main = do
  hSetBuffering stdout LineBuffering
  hSetBuffering stderr LineBuffering
  mainImpl `catch` \(e :: SomeException) -> do
    logSupervisor $ "FATAL unhandled exception: " ++ displayException e
    throwIO e

mainImpl :: IO ()
mainImpl = do
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

  logSupervisor $ "Launching " ++ show (length commandList) ++ " processes..."
  asyncs <- sequence $ map launchCommand commandList

  result <- waitAnyOrInterrupt asyncs
  case result of
    Right (_, processExit) -> do
      logSupervisor $
        "ERROR: process " ++ renderCommand (processCmd processExit) (processArgs processExit)
        ++ " pid=" ++ show (processPid processExit)
        ++ " exited with " ++ describeExitCode (processExitCode processExit)
        ++ " started_at=" ++ formatTimestamp (processStartedAt processExit)
        ++ " finished_at=" ++ formatTimestamp (processFinishedAt processExit)
        ++ " log=" ++ processLogFile processExit
      killRemainingExcept (processPid processExit)
      logSupervisor $ "Tail of log for exited process: " ++ processLogFile processExit
      tailFile 20 (processLogFile processExit)
    Left signalName -> do
      logSupervisor $ "Interrupted by " ++ signalName
      killAllProcesses

  -- Stop docker compose on shutdown (unless --no-docker)
  unless noDocker dockerComposeDown

  removeFile pidFile `catch` \e ->
    logSupervisor $ "Warning: could not delete pid file: " ++ show (e :: IOError)
  logSupervisor "Shutdown complete."
