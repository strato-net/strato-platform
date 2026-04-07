{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Auth.Retry (withRetry) where

import Control.Concurrent (threadDelay)
import Control.Exception (SomeException, throwIO, try)
import System.IO (hPutStrLn, stderr)

-- | Retry an IO action on exception with exponential backoff.
--
-- Waits 1s, 2s, 4s, 8s, ... (capped at 30s) between retries.
-- Logs each failed attempt to stderr.
-- After all attempts are exhausted, re-throws the last exception.
withRetry
  :: String  -- ^ Label for log messages
  -> Int     -- ^ Maximum number of attempts (>= 1)
  -> IO a
  -> IO a
withRetry label maxAttempts action = go 1
  where
    go attempt = do
      result <- try action
      case result of
        Right val -> return val
        Left (e :: SomeException)
          | attempt >= maxAttempts -> throwIO e
          | otherwise -> do
              let delaySec = min 30 (2 ^ (attempt - 1) :: Int)
              hPutStrLn stderr $
                label ++ ": attempt " ++ show attempt ++ "/" ++ show maxAttempts ++
                " failed (" ++ show e ++ "), retrying in " ++ show delaySec ++ "s"
              threadDelay (delaySec * 1000000)
              go (attempt + 1)
