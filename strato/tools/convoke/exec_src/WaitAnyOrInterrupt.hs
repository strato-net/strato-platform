{-# OPTIONS -fno-warn-incomplete-uni-patterns #-}
{-# OPTIONS -fno-warn-missing-export-lists #-}

module WaitAnyOrInterrupt where

import Control.Concurrent (myThreadId)
import Control.Concurrent.Async (Async, waitAny)
import Control.Exception (catch, throwTo, AsyncException(UserInterrupt))
import System.Posix.Signals (installHandler, sigTERM, sigINT, Handler(CatchOnce))

-- | Make SIGTERM and SIGINT throw UserInterrupt to the calling thread.
--
-- Install before launching children so shutdown signals are handled before
-- the first wait.
installInterruptHandler :: IO ()
installInterruptHandler = do
  mainThread <- myThreadId
  let handler = CatchOnce $ throwTo mainThread UserInterrupt
  _ <- installHandler sigTERM handler Nothing
  _ <- installHandler sigINT handler Nothing
  return ()

-- | 'waitAny', or 'Nothing' if an interrupt arrives first.
-- Requires 'installInterruptHandler' to have run.
awaitAnyOrInterrupt :: [Async a] -> IO (Maybe (Async a, a))
awaitAnyOrInterrupt asyncs =
  catch
    (Just <$> waitAny asyncs)
    (\UserInterrupt -> return Nothing)

waitAnyOrInterrupt :: [Async a] -> IO (Maybe (Async a, a))
waitAnyOrInterrupt asyncs = installInterruptHandler >> awaitAnyOrInterrupt asyncs
