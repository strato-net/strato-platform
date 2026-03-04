
{-# OPTIONS -fno-warn-incomplete-uni-patterns #-}
{-# OPTIONS -fno-warn-missing-export-lists #-}

module WaitAnyOrInterrupt where

import Control.Concurrent.Async (Async, waitAny)
import Control.Exception (catch, throwIO, AsyncException(UserInterrupt))
import System.Posix.Signals (installHandler, sigTERM, Handler(CatchOnce))

waitAnyOrInterrupt :: [Async a] -> IO (Maybe (Async a, a))
waitAnyOrInterrupt asyncs = do
  -- Make SIGTERM behave like SIGINT (Ctrl-C)
  _ <- installHandler sigTERM (CatchOnce $ throwIO UserInterrupt) Nothing
  catch
    (Just <$> waitAny asyncs)
    (\UserInterrupt -> return Nothing)
