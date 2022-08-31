{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Init ( blockappsInit ) where

import BlockApps.Logging (LoggingT)
import Control.Concurrent
import Control.Monad
import Control.Monad.IO.Class (liftIO)
import Control.Monad.Trans.Resource (ResourceT)
import Data.List (intercalate)
import Data.Text hiding (intercalate)
import Foreign hiding (void)
import Foreign.C
import GHC.Environment
import Prometheus
import System.IO
import System.Posix.Signals

import Blockapps.Crossmon

instance MonadMonitor (ResourceT (LoggingT IO)) where
    doIO = liftIO

foreign import ccall unsafe "execvp"
  c_execvp :: CString -> Ptr CString -> IO CInt

selfExec :: IO ()
selfExec = do
  tid <- myThreadId
  putStrLn $ "attempting to self exec " ++ show tid
  argv@(cmd:_) <- getFullArgs
  putStrLn $ "caught sig-hup; self-reexec: " ++ intercalate " " argv
  hFlush stdout
  cmdC <- newCString cmd
  argvC <- mapM newCString argv
  withArray0 nullPtr argvC $ \argvPC -> do
    void $ c_execvp cmdC argvPC
    throwErrno "unable to exec"

blockappsInit :: Text -> IO ()
blockappsInit self = do
  tid <- myThreadId
  putStrLn $ "blockapps-init for " ++ show tid
  initializeHealthChecks self

  -- TODO: exec self
  void $ installHandler sigHUP (Catch selfExec) Nothing
