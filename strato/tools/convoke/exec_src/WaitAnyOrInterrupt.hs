{-# OPTIONS -fno-warn-incomplete-uni-patterns #-}
{-# OPTIONS -fno-warn-missing-export-lists #-}

module WaitAnyOrInterrupt where

import Control.Concurrent (myThreadId)
import Control.Concurrent.Async (Async, waitAny)
import Control.Exception (catch, throwTo, AsyncException(UserInterrupt))
import System.Posix.Signals (installHandler, sigTERM, sigINT, Handler(CatchOnce))

waitAnyOrInterrupt :: [Async a] -> IO (Maybe (Async a, a))
waitAnyOrInterrupt asyncs = do
  mainThread <- myThreadId
  -- Make SIGTERM and SIGINT throw UserInterrupt to the main thread
  let handler = CatchOnce $ throwTo mainThread UserInterrupt
  _ <- installHandler sigTERM handler Nothing
  _ <- installHandler sigINT handler Nothing
  catch
    (Just <$> waitAny asyncs)
    (\UserInterrupt -> return Nothing)
