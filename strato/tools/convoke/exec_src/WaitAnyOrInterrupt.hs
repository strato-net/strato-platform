
{-# OPTIONS -fno-warn-incomplete-uni-patterns #-}
{-# OPTIONS -fno-warn-missing-export-lists #-}

module WaitAnyOrInterrupt where

import Control.Concurrent.Async (Async, waitAny)
import Control.Exception (catch, AsyncException(UserInterrupt))
--import System.Exit (exitSuccess)

waitAnyOrInterrupt :: [Async a] -> IO (Maybe (Async a, a))
waitAnyOrInterrupt asyncs =
  catch
    (Just <$> waitAny asyncs)
    (\UserInterrupt -> return Nothing)
