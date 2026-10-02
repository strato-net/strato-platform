{-# OPTIONS -fno-warn-incomplete-uni-patterns #-}
{-# OPTIONS -fno-warn-missing-export-lists #-}

module WaitAnyOrInterrupt where

import Control.Concurrent (myThreadId)
import Control.Concurrent.Async (Async, waitAny)
import Control.Exception (catch, throwTo, AsyncException(UserInterrupt))
import System.Posix.Signals (installHandler, sigTERM, sigINT, Handler(Catch))

-- | Make SIGTERM and SIGINT throw UserInterrupt to the calling thread.
--
-- Separate from the wait so a supervisor that waits repeatedly installs the
-- handler once, before its loop. The handler is persistent (not one-shot): the
-- supervisor loops, restarting children, so an interrupt can arrive at any
-- point of its life and must always reach it. A one-shot handler leaves a
-- window after it fires in which a signal takes the default action and kills
-- convoke outright, orphaning every child it was supervising.
installInterruptHandler :: IO ()
installInterruptHandler = do
  mainThread <- myThreadId
  let handler = Catch $ throwTo mainThread UserInterrupt
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
