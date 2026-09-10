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
import System.Posix.Signals (signalProcess, sigTERM, sigKILL, Signal)
import System.Posix.Process (getProcessStatus, ProcessStatus)
import System.Posix.Resource (Resource(ResourceOpenFiles), ResourceLimit(..), ResourceLimits(..), getResourceLimit, setResourceLimit)
import Control.Concurrent (threadDelay)
import Control.Concurrent.Async
import Control.Exception
import Control.Monad
import Text.Read (readMaybe)
import Data.List (partition)
import Data.Maybe (catMaybes)
import Data.Time (NominalDiffTime, UTCTime, diffUTCTime, getCurrentTime)
import qualified ShellWords as Sh
import System.FilePath ((</>))
import Log
import WaitAnyOrInterrupt

-- File locations
commandsFile :: FilePath
commandsFile = "commands.txt"

pidFile :: FilePath
pidFile = "pids.txt"

logsDir :: FilePath
logsDir = "logs"

-- | One line of commands.txt. A leading "@restart" marks a process convoke
-- restarts by itself when it exits; any other process exiting takes the
-- whole directory down (the consensus processes share state a lone restart
-- cannot recover, so strato-setup marks only indexers, API servers and the
-- helpers as restartable).
data Spec = Spec FilePath [String] Bool  -- command, arguments, restartable

specRestart :: Spec -> Bool
specRestart (Spec _ _ r) = r

restartMarker :: String
restartMarker = "@restart"

-- Parse a shell-style command line
parseLine :: String -> Maybe Spec
parseLine line =
  case Sh.parse line of
    Left _ -> Nothing
    Right [] -> Nothing
    Right (marker:cmd:args) | marker == restartMarker -> Just (Spec cmd args True)
    Right [marker] | marker == restartMarker -> Nothing
    Right (cmd:args) -> Just (Spec cmd args False)

-- Launch a command and track its PID
launchCommand :: Spec -> IO (Async (ExitCode, ProcessID, FilePath))
launchCommand (Spec cmd args _) = do
  let logFile = logsDir </> cmd
  createDirectoryIfMissing True logsDir
  -- Append so logs survive restarts (like the docker service logs, which use
  -- ">>"); strato-logrotate bounds their growth. Append mode is also required
  -- for rotation via copytruncate: only O_APPEND writers continue at the new
  -- end of file after truncation (a WriteMode handle would keep its old
  -- offset and turn the log into a sparse file).
  h <- openFile logFile AppendMode

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
      -- Log the full command line: the RTS flags in it are sized per machine
      -- at setup time (see Blockchain.Init.RtsFlags), and support needs to see
      -- what a node is actually running with from convoke.log alone.
      say $ "Started: " ++ unwords (cmd : args) ++ " (PID " ++ show pid ++ ")"
      async $ do
        ec <- waitForProcess ph
        hClose h
        return (ec, pid, cmd)




-- Send a signal to the process group led by the given PID.
-- Children are launched with create_group=True, so each recorded PID is a
-- process group leader and negating it targets the whole group. This reaches
-- worker threads/children (e.g. strato-api running with -N4) that would
-- otherwise be orphaned and keep holding resources like listening sockets.
signalGroup :: Signal -> ProcessID -> IO ()
signalGroup sig pid = do
  result <- try $ signalProcess sig (negate pid) :: IO (Either SomeException ())
  case result of
    Left e  -> say $ "Failed to signal group " ++ show pid ++ ": " ++ displayException e
    Right _ -> return ()

-- True if the process has been reaped (no longer exists).
processGone :: ProcessID -> IO Bool
processGone pid = do
  result <- try (getProcessStatus False False pid)
             :: IO (Either SomeException (Maybe ProcessStatus))
  case result of
    Left _        -> return True   -- ESRCH/ECHILD: nothing left to reap
    Right Nothing -> return False  -- still alive
    Right (Just _) -> return True  -- reaped

-- Kill all recorded process groups: SIGTERM, wait, then SIGKILL stragglers.
-- The crashed process is included here on purpose. Its leader PID may already
-- be dead, but children/workers in its group (the orphaned listener) are not,
-- so we must still terminate the whole group.
killAllProcesses :: IO ()
killAllProcesses = do
  exists <- doesFileExist pidFile
  if not exists
    then return ()
    else do
      contents <- readFile pidFile
      let maybePids = mapM readMaybe (lines contents) :: Maybe [ProcessID]
      case maybePids of
        Nothing -> say "Warning: invalid PIDs in pid file"
        Just pids -> do
          forM_ pids $ \pid -> do
            signalGroup sigTERM pid
            say $ "Sent SIGTERM to group " ++ show pid
          -- Give processes a chance to exit cleanly before escalating.
          threadDelay (5 * 1000 * 1000)  -- 5 seconds
          forM_ pids $ \pid -> do
            gone <- processGone pid
            unless gone $ do
              signalGroup sigKILL pid
              say $ "Sent SIGKILL to group " ++ show pid

-- Get the last n elements from a list
tailN :: Int -> [a] -> [a]
tailN n xs = drop (length xs - n) xs

-- Log the last n lines of a file without reading it all into memory.
-- Process logs can grow to many GB; the previous implementation read the
-- entire file as a String (~16 bytes/char), which could OOM the host when a
-- child exited. We seek near the end and only examine the trailing bytes.
tailFile :: Int -> FilePath -> IO ()
tailFile n path = handle onErr $
  withFile path ReadMode $ \h -> do
    size <- hFileSize h
    let maxBytes = 65536 :: Integer  -- enough to hold the last n log lines
        start = max 0 (size - maxBytes)
    when (start > 0) $ hSeek h AbsoluteSeek start
    contents <- hGetContents h
    -- If we started mid-file the first line is likely partial; drop it.
    let ls = lines contents
        ls' = if start > 0 then drop 1 ls else ls
    sayBlock ("Tail of " ++ path ++ ":") (tailN n ls')
  where
    onErr e =
      say $ "Warning: could not tail " ++ path ++ ": " ++ show (e :: SomeException)

-- Start docker compose containers
dockerComposeUp :: IO ()
dockerComposeUp = do
  uid <- show <$> getEffectiveUserID
  gid <- show <$> getEffectiveGroupID
  setEnv "DOCKER_UID" uid
  setEnv "DOCKER_GID" gid
  say "Starting Docker containers..."
  -- Redirect docker compose stderr to stdout (goes to log, not terminal)
  let cp = (proc "docker" ["compose", "-p", "strato", "up", "-d", "--wait"])
             { std_err = UseHandle stdout }
  (_, _, _, ph) <- createProcess cp
  ec <- waitForProcess ph
  case ec of
    ExitSuccess -> say "Docker containers started."
    ExitFailure code -> do
      say $ "ERROR: docker compose up failed with exit code " ++ show code
      exitWith ec

-- Stop docker compose containers
dockerComposeDown :: IO ()
dockerComposeDown = do
  say "Stopping Docker containers..."
  -- Redirect docker compose stderr to stdout (goes to log, not terminal)
  let cp = (proc "docker" ["compose", "-p", "strato", "down"])
             { std_err = UseHandle stdout }
  (_, _, _, ph) <- createProcess cp
  _ <- waitForProcess ph
  say "Docker containers stopped."

data Child = Child
  { childAsync :: Async (ExitCode, ProcessID, FilePath)
  , childSpec :: Spec
  , childStarted :: UTCTime
  , childRestarts :: Int  -- consecutive quick exits, drives the backoff
  }

-- | A child that stayed up this long before exiting is treated as a fresh
-- failure, not the next round of a crash loop.
stableRunSeconds :: NominalDiffTime
stableRunSeconds = 300

maxRestartDelaySeconds :: Int
maxRestartDelaySeconds = 60

-- | Wait for children to exit. A restartable child is relaunched after an
-- exponential backoff (1s, 2s, 4s ... capped) and supervision continues; any
-- other exit stops everything, as it always has.
supervise :: [Child] -> IO ()
supervise [] = say "No processes left to supervise."
supervise children = do
  (finished, (exitCode, pid, cmd)) <- waitAny (map childAsync children)
  let (exited, rest) = partition ((== finished) . childAsync) children
  case exited of
    [child] | specRestart (childSpec child) -> do
      now <- getCurrentTime
      let quick = diffUTCTime now (childStarted child) < stableRunSeconds
          restarts = if quick then childRestarts child + 1 else 1
          delaySeconds = min maxRestartDelaySeconds (2 ^ (min 6 (restarts - 1)) :: Int)
      say $ "Process " ++ cmd ++ " (PID " ++ show pid ++ ") exited with: " ++ show exitCode
        ++ "; restarting in " ++ show delaySeconds ++ "s (attempt " ++ show restarts ++ ")"
      tailFile 20 (logsDir </> cmd)
      threadDelay (delaySeconds * 1000 * 1000)
      a <- launchCommand (childSpec child)
      started <- getCurrentTime
      supervise (rest ++ [Child a (childSpec child) started restarts])
    _ -> do
      say $ "ERROR: Process " ++ cmd ++ " (PID " ++ show pid ++ ") exited with: " ++ show exitCode
      killAllProcesses
      tailFile 20 (logsDir </> cmd)

-- | Children inherit convoke's open-file limit, and the usual soft default of
-- 1024 is too low: ethereum-jsonrpc opens a fresh Kafka connection per callVM
-- request and only closes it ~10s after use, so a load test exhausts
-- descriptors ("Too many open files"). Raise the soft limit to 8192, or to the
-- hard limit if that is lower; no privilege is needed for that. Never lower it.
raiseOpenFileLimit :: IO ()
raiseOpenFileLimit = do
  limits <- getResourceLimit ResourceOpenFiles
  let wanted = case hardLimit limits of
        ResourceLimit h -> min 8192 h
        _ -> 8192
  case softLimit limits of
    ResourceLimit s | s < wanted -> do
      setResourceLimit ResourceOpenFiles limits { softLimit = ResourceLimit wanted }
      say $ "Raised open-file soft limit from " ++ show s ++ " to " ++ show wanted
    _ -> return ()

main :: IO ()
main = do
  setupLogging
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

  raiseOpenFileLimit
  say $ "Launching " ++ show (length commandList) ++ " processes..."
  running <- forM commandList $ \spec -> do
    a <- launchCommand spec
    started <- getCurrentTime
    return (Child a spec started 0)

  result <- withInterrupts $ supervise running
  case result of
    Just () -> return ()
    Nothing -> do
      say "Interrupted; stopping all processes"
      killAllProcesses

  -- Stop docker compose on shutdown (unless --no-docker)
  unless noDocker dockerComposeDown

  removeFile pidFile `catch` \e ->
    say $ "Warning: could not delete pid file: " ++ show (e :: IOError)
  say "Shutdown complete."
