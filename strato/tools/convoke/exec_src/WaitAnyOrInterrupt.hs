{-# OPTIONS -fno-warn-incomplete-uni-patterns #-}
{-# OPTIONS -fno-warn-missing-export-lists #-}

module WaitAnyOrInterrupt where

import Control.Concurrent (myThreadId)
import Control.Exception (catch, throwTo, AsyncException(UserInterrupt))
import System.Posix.Signals (installHandler, sigTERM, sigINT, Handler(Catch))

-- | Run the supervisor with SIGTERM and SIGINT turned into 'UserInterrupt'
-- on the calling thread for the whole duration, including the pauses
-- between restarts. Returns 'Nothing' if interrupted.
--
-- The handlers are persistent (not one-shot): the supervisor now loops,
-- restarting children, so an interrupt can arrive at any point of its life
-- and must always reach it, or convoke would die and orphan its children.
withInterrupts :: IO a -> IO (Maybe a)
withInterrupts body = do
  mainThread <- myThreadId
  let handler = Catch $ throwTo mainThread UserInterrupt
  _ <- installHandler sigTERM handler Nothing
  _ <- installHandler sigINT handler Nothing
  catch
    (Just <$> body)
    (\UserInterrupt -> return Nothing)
