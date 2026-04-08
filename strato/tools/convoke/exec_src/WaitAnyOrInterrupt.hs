{-# LANGUAGE DeriveDataTypeable #-}

{-# OPTIONS -fno-warn-incomplete-uni-patterns #-}
{-# OPTIONS -fno-warn-missing-export-lists #-}

module WaitAnyOrInterrupt where

import Control.Concurrent (myThreadId)
import Control.Concurrent.Async (Async, waitAny)
import Control.Exception (Exception, catch, throwTo)
import Data.Typeable (Typeable)
import System.Posix.Signals (installHandler, sigTERM, sigINT, sigHUP, sigQUIT, Handler(CatchOnce))

data InterruptSignal = InterruptSignal String
  deriving (Show, Typeable)

instance Exception InterruptSignal

waitAnyOrInterrupt :: [Async a] -> IO (Either String (Async a, a))
waitAnyOrInterrupt asyncs = do
  mainThread <- myThreadId
  let install sig name = installHandler sig (CatchOnce $ throwTo mainThread (InterruptSignal name)) Nothing
  _ <- install sigTERM "SIGTERM"
  _ <- install sigINT "SIGINT"
  _ <- install sigHUP "SIGHUP"
  _ <- install sigQUIT "SIGQUIT"
  catch
    (Right <$> waitAny asyncs)
    (\(InterruptSignal name) -> return (Left name))
