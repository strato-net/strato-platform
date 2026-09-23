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
import Data.Time.Clock (NominalDiffTime, UTCTime, diffUTCTime, getCurrentTime)
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

-- Parse a shell-style command line into (cmd, args)
parseLine :: String -> Maybe (FilePath, [String])
parseLine line =
  case Sh.parse line of
    Left _ -> Nothing
    Right [] -> Nothing
    Right (cmd:args) -> Just (cmd, args)

-- | A running child process, with what it takes to relaunch it.
data Child = Child
  { childCmd :: (FilePath, [String])
  , childPid :: ProcessID
  , childStarted :: UTCTime
  , childAsync :: Async (ExitCode, ProcessID, FilePath)
  }

-- Launch a command and track its PID
launchCommand :: (FilePath, [String]) -> IO Child
launchCommand cmdArgs@(cmd, args) = do
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
      -- Log the full command line: the RTS flags in it are sized per machine
      -- at setup time (see Blockchain.Init.RtsFlags), and support needs to see
      -- what a node is actually running with from convoke.log alone.
      say $ "Started: " ++ unwords (cmd : args) ++ " (PID " ++ show pid ++ ")"
      started <- getCurrentTime
      a <- async $ do
        ec <- waitForProcess ph
        hClose h
        return (ec, pid, cmd)
      return $ Child cmdArgs pid started a

-- | Rewrite pids.txt from the children that are actually running.
--
-- Each launch used to append a line. That was harmless while a child was never
-- relaunched, but a restarted command leaves its dead PID behind, and
-- 'killAllProcesses' signals every PID it reads: once the kernel recycles that
-- number, shutdown would signal an unrelated process group.
writePidFile :: [Child] -> IO ()
writePidFile children = writeFile pidFile $ unlines (map (show . childPid) children)




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

-- | How many times in a row a single command may be relaunched before convoke
-- treats its failure as permanent and shuts the node down.
maxRestarts :: Int
maxRestarts = 8

-- | A child that stays up this long has recovered, so its restart budget is
-- returned. Anything shorter is a crash loop and keeps spending it.
restartBudgetReset :: NominalDiffTime
restartBudgetReset = 300

-- | Pause before the Nth relaunch, doubling each time up to a cap.
--
-- A fixed pause makes the tolerance window @maxRestarts * delay@, which stayed
-- flat no matter how many attempts were allowed -- 10 seconds at 5 restarts of
-- 2s. Production showed that is far too short for a slow dependency: a
-- sequencer that loses the startup race against Redis loading its dataset dies
-- in ~15ms with @LOADING Redis is loading the dataset in memory@, so the whole
-- budget was spent in well under a minute of real waiting and convoke shut down
-- a node that only needed to wait. Doubling makes the window grow with the
-- attempts instead: 2+4+8+16+30+30+30 is about two minutes before the last try.
restartDelay :: Int -> Int
restartDelay attempt = min maxRestartDelay (baseRestartDelay * (2 ^ max 0 (attempt - 1)))

baseRestartDelay :: Int
baseRestartDelay = 2 * 1000 * 1000

maxRestartDelay :: Int
maxRestartDelay = 30 * 1000 * 1000

-- | Supervise the children, relaunching any that exit.
--
-- Returns 'True' for a clean interrupt and 'False' when a command exhausted its
-- restart budget; either way the caller does the shutdown.
--
-- convoke used to stop at the *first* child exit and go straight to
-- killAllProcesses and "docker compose down", so one process dying removed
-- every container on the host. That is how a single uncaught exception in
-- vm-runner became four fully offline validators at helium block 595971: the
-- chain was intact and the nodes were gone, with "docker ps -a" empty on all of
-- them. A process that dies once is now restarted in place; only one that will
-- not stay up takes the node down with it.
supervise :: [Child] -> IO Bool
supervise = go []
  where
    go budgets children = do
      result <- awaitAnyOrInterrupt (map childAsync children)
      case result of
        Nothing -> do
          say "Interrupted by Ctrl-C"
          return True
        Just (finished, (exitCode, pid, cmd)) -> do
          now <- getCurrentTime
          let (dead, survivors) = partition ((== finished) . childAsync) children
          say $ "ERROR: Process " ++ cmd ++ " (PID " ++ show pid ++ ") exited with: " ++ show exitCode
          tailFile 20 (logsDir </> cmd)
          case dead of
            [] -> do
              -- Unreachable: the Async came out of this very list.
              say $ "Internal error: no tracked child matched " ++ cmd ++ "; shutting down."
              return False
            (c : _) -> do
              let ranFor = diffUTCTime now (childStarted c)
                  attempt
                    | ranFor >= restartBudgetReset = 1
                    | otherwise = 1 + maybe 0 id (lookup cmd budgets)
              if attempt > maxRestarts
                then do
                  say $ "Giving up on " ++ cmd ++ ": " ++ show maxRestarts
                          ++ " restarts without staying up for " ++ show restartBudgetReset
                          ++ ". Shutting the node down."
                  return False
                else do
                  say $ "Restarting " ++ cmd ++ " (attempt " ++ show attempt ++ " of "
                          ++ show maxRestarts ++ "; it ran for " ++ show ranFor ++ ")"
                  threadDelay (restartDelay attempt)
                  -- A relaunch can fail outright (launchCommand errors when it
                  -- cannot read the new PID). Treat that as the give-up case
                  -- rather than letting it escape: an exception here would skip
                  -- the caller's killAllProcesses and leave the surviving
                  -- children running with no supervisor and no pid file.
                  attempted <- try (launchCommand (childCmd c))
                  case attempted of
                    Left e -> do
                      say $ "Could not restart " ++ cmd ++ ": "
                              ++ displayException (e :: SomeException)
                              ++ ". Shutting the node down."
                      return False
                    Right restarted -> do
                      let children' = restarted : survivors
                      writePidFile children'
                      go ((cmd, attempt) : filter ((/= cmd) . fst) budgets) children'

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
  -- Before the first wait, so no signal arrives while the handler is unset.
  installInterruptHandler
  children <- mapM launchCommand commandList
  writePidFile children

  _ <- supervise children
  killAllProcesses

  -- Stop docker compose on shutdown (unless --no-docker)
  unless noDocker dockerComposeDown

  removeFile pidFile `catch` \e ->
    say $ "Warning: could not delete pid file: " ++ show (e :: IOError)
  say "Shutdown complete."
