-- | Timestamped, single-stream logging for convoke.
module Log
  ( setupLogging
  , say
  , sayBlock
  ) where

import Data.Time.Clock (getCurrentTime)
import Data.Time.Format (defaultTimeLocale, formatTime)
import System.IO

-- | Send every convoke diagnostic to stderr, line-buffered.
--
-- All of convoke's own output has to go to a single stream. strato-up runs us as
--
--     nohup convoke > >(tee -a logs/convoke.log) 2> >(tee -a logs/convoke.log >&2) &
--
-- so stdout and stderr are separate pipes feeding two independent "tee -a"
-- processes that append to the same file: anything split across the two streams
-- lands in convoke.log in nondeterministic order. Worse, a pipe makes GHC pick
-- BlockBuffering for stdout, and the handful of progress messages convoke used
-- to write there totalled only ~430 bytes -- never reaching the 8KB flush
-- threshold, so they sat in the buffer for the entire life of the node and were
-- flushed on exit, i.e. *after* the shutdown messages on stderr. The result was
-- a log that ended
--
--     Docker containers stopped.
--     Shutdown complete.
--     Starting Docker containers...
--     Launching 10 processes...
--     Started: ethereum-discover (PID 189313)
--
-- which reads as though a node that had just been cleanly terminated
-- spontaneously restarted itself -- and the PIDs on those trailing lines are
-- the same ones the SIGTERMs above were sent to. One stream, line-buffered,
-- with timestamps, keeps the log in the order things actually happened.
setupLogging :: IO ()
setupLogging = do
  hSetBuffering stderr LineBuffering
  -- convoke itself no longer writes to stdout; children that inherit the fd do
  -- their own buffering. Set it anyway so a stray write can't be swallowed.
  hSetBuffering stdout LineBuffering

-- | Timestamp prefix matching the format the Haskell services use
-- (@[2026-08-13 17:28:44.123456789 UTC]@), so convoke.log can be interleaved
-- with logs/strato-p2p, logs/vm-runner and friends by sorting on the prefix.
stamp :: IO String
stamp = do
  now <- getCurrentTime
  return $ "[" ++ formatTime defaultTimeLocale "%Y-%m-%d %H:%M:%S%Q UTC" now
             ++ "] convoke | "

-- | Log one line. A single hPutStrLn keeps the timestamp and the message
-- together even when called from a signal handler thread.
say :: String -> IO ()
say msg = do
  p <- stamp
  hPutStrLn stderr $ p ++ msg

-- | Log a titled, indented block (a process table dump, a tail of a log) in one
-- write, so it cannot be interleaved with other lines part-way through.
sayBlock :: String -> [String] -> IO ()
sayBlock title ls = do
  p <- stamp
  hPutStr stderr $ unlines $ (p ++ title) : map ("    " ++) ls
